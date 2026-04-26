/**
 * Jira-only MCP Worker — jira.tuongbeo.workers.dev
 * MCP URL: https://jira.tuongbeo.workers.dev/mcp
 *
 * Separate domain from confluence worker = independent Claude.ai tool budget.
 * No /jira slug in routes — this worker serves only Jira.
 *
 * Phase 3 deployment: requires Atlassian App Link update before going live.
 * DO NOT DEPLOY until explicit confirmation.
 */

import { Hono } from "hono";
import { Env } from "../../shared/types";
import {
  buildOAuthMetadata,
  buildResourceMetadata,
  handleAuthorize,
  handleCallback,
  handleToken,
  CALLBACK_PATH,
} from "../../shared/oauth";
import { handleMcpRequest } from "../../shared/mcp-agent";
import { verifyJWT, getValidAccessToken } from "../../shared/jwt";
import { decrypt } from "../../shared/crypto";
import { parseClientId, MAX_UPLOAD_BYTES } from "../../shared/types";

const SVC = "jira" as const;
const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({
  status: "ok",
  service: "jira",
  version: "2.0.0",
  mcp: `${c.env.PUBLIC_BASE_URL}/mcp`,
  timestamp: new Date().toISOString(),
}));

app.get("/.well-known/oauth-protected-resource/mcp", (c) =>
  c.json(buildResourceMetadata(c.env.PUBLIC_BASE_URL, "/mcp")));

app.get("/.well-known/oauth-protected-resource", (c) =>
  c.json(buildResourceMetadata(c.env.PUBLIC_BASE_URL, "/mcp")));

app.get("/.well-known/oauth-authorization-server", (c) =>
  c.json(buildOAuthMetadata(c.env.PUBLIC_BASE_URL, c.env.PUBLIC_BASE_URL)));

app.get("/authorize", async (c) => handleAuthorize(c.req.raw, c.env, SVC));
app.post("/token", async (c) => handleToken(c.req.raw, c.env));
app.get(CALLBACK_PATH, async (c) => handleCallback(c.req.raw, c.env));

app.post("/register", async (c) => {
  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch { /* ok */ }
  return c.json({
    client_id: (body.client_id as string) ?? crypto.randomUUID(),
    client_secret: (body.client_secret as string) ?? crypto.randomUUID(),
    redirect_uris: body.redirect_uris ?? [],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
  }, 201);
});

app.all("/mcp", async (c) => {
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const base = c.env.PUBLIC_BASE_URL;
  if (!token) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": [
          `Bearer realm="${base}"`,
          `resource_metadata_url="${base}/.well-known/oauth-protected-resource"`,
        ].join(", "),
      },
    });
  }
  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) {
    return new Response(
      JSON.stringify({ error: "invalid_token", error_description: "Token invalid or expired." }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": `Bearer realm="${base}", error="invalid_token", resource_metadata_url="${base}/.well-known/oauth-protected-resource"`,
        },
      }
    );
  }
  return handleMcpRequest(c.req.raw, c.env, SVC);
});

// ── Upload proxy ──────────────────────────────────────────────────────────────

async function getAtlassianCreds(token: string, env: Env) {
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) throw new Error("invalid_token");
  const sub = (payload as { sub: string }).sub;
  const { accessToken, record } = await getValidAccessToken(sub, env);
  if (record.serviceType !== "jira") throw new Error(`Token issued for ${record.serviceType}, not jira`);
  const rawClientId = await decrypt(record.enc_client_id, env.JWT_SECRET);
  if (!rawClientId) throw new Error("invalid_token");
  const parsed = parseClientId(rawClientId);
  if (!parsed) throw new Error("invalid_token");
  return { accessToken, instanceUrl: parsed.instanceUrl };
}

/** POST /upload/:issueKey — upload binary file as attachment to a Jira issue */
app.post("/upload/:issueKey", async (c) => {
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return c.json({ error: "unauthorized" }, 401);
  let accessToken: string; let instanceUrl: string;
  try { ({ accessToken, instanceUrl } = await getAtlassianCreds(token, c.env)); }
  catch (e) { return c.json({ error: "auth_error", message: String(e) }, 401); }
  const issueKey = c.req.param("issueKey");
  const contentLength = parseInt(c.req.header("content-length") ?? "0", 10);
  if (contentLength > MAX_UPLOAD_BYTES) return c.json({ error: "file_too_large", max_mb: 20 }, 413);
  let formData: FormData;
  try { formData = await c.req.formData(); }
  catch { return c.json({ error: "invalid_multipart" }, 400); }
  const fileField = formData.get("file");
  if (!fileField || !(fileField instanceof File)) return c.json({ error: "missing_file" }, 400);
  const fileBytes = await fileField.arrayBuffer();
  if (fileBytes.byteLength > MAX_UPLOAD_BYTES) return c.json({ error: "file_too_large", max_mb: 20 }, 413);
  const filename = (formData.get("filename") as string | null) ?? fileField.name ?? "attachment";
  const base = instanceUrl.replace(/\/$/, "");
  const uploadForm = new FormData();
  uploadForm.append("file", new Blob([fileBytes], { type: fileField.type || "application/octet-stream" }), filename);
  const uploadRes = await fetch(`${base}/rest/api/2/issue/${issueKey}/attachments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "X-Atlassian-Token": "no-check", Accept: "application/json" },
    body: uploadForm,
  });
  if (!uploadRes.ok) { const e = await uploadRes.text(); return c.json({ error: "atlassian_upload_failed", status: uploadRes.status, detail: e.slice(0, 400) }, 502); }
  const result = await uploadRes.json() as Array<{ id: string; filename: string }>;
  return c.json({ action: "attachment_created", issue_key: issueKey, filename, attachment_id: result[0]?.id, size_bytes: fileBytes.byteLength });
});

/** PUT /upload/:issueKey/:filename — atomic replace: find+delete+upload */
app.put("/upload/:issueKey/:filename", async (c) => {
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return c.json({ error: "unauthorized" }, 401);
  let accessToken: string; let instanceUrl: string;
  try { ({ accessToken, instanceUrl } = await getAtlassianCreds(token, c.env)); }
  catch (e) { return c.json({ error: "auth_error", message: String(e) }, 401); }
  const issueKey = c.req.param("issueKey");
  const filename = decodeURIComponent(c.req.param("filename"));
  const base = instanceUrl.replace(/\/$/, "");
  let formData: FormData;
  try { formData = await c.req.formData(); }
  catch { return c.json({ error: "invalid_multipart" }, 400); }
  const fileField = formData.get("file");
  if (!fileField || !(fileField instanceof File)) return c.json({ error: "missing_file" }, 400);
  const fileBytes = await fileField.arrayBuffer();
  if (fileBytes.byteLength > MAX_UPLOAD_BYTES) return c.json({ error: "file_too_large", max_mb: 20 }, 413);
  let deletedId: string | null = null;
  const issueRes = await fetch(`${base}/rest/api/2/issue/${issueKey}?fields=attachment`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (issueRes.ok) {
    const issueData = await issueRes.json() as { fields?: { attachment?: Array<{ id: string; filename: string }> } };
    const existing = issueData.fields?.attachment?.find(a => a.filename === filename);
    if (existing) {
      await fetch(`${base}/rest/api/2/attachment/${existing.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
      deletedId = existing.id;
    }
  }
  const uploadForm = new FormData();
  uploadForm.append("file", new Blob([fileBytes], { type: fileField.type || "application/octet-stream" }), filename);
  const uploadRes = await fetch(`${base}/rest/api/2/issue/${issueKey}/attachments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "X-Atlassian-Token": "no-check", Accept: "application/json" },
    body: uploadForm,
  });
  if (!uploadRes.ok) { const e = await uploadRes.text(); return c.json({ error: "upload_failed", status: uploadRes.status, detail: e.slice(0, 400) }, 502); }
  const result = await uploadRes.json() as Array<{ id: string; filename: string }>;
  return c.json({ action: "attachment_replaced", issue_key: issueKey, filename, deleted_id: deletedId, created_id: result[0]?.id, size_bytes: fileBytes.byteLength });
});

app.notFound((c) => c.json({ error: "not_found" }, 404));
export default app;
