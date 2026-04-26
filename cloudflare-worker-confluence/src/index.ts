/**
 * Confluence-only MCP Worker — confluence.tuongbeo.workers.dev
 * MCP URL: https://confluence.tuongbeo.workers.dev/mcp
 *
 * Separate domain from jira worker = independent Claude.ai tool budget.
 * No /confluence slug in routes — this worker serves only Confluence.
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
import { insertIntoPageBody } from "../../shared/atlassian";

const SVC = "confluence" as const;
const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({
  status: "ok",
  service: "confluence",
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
  if (record.serviceType !== "confluence") throw new Error(`Token issued for ${record.serviceType}, not confluence`);
  const rawClientId = await decrypt(record.enc_client_id, env.JWT_SECRET);
  if (!rawClientId) throw new Error("invalid_token");
  const parsed = parseClientId(rawClientId);
  if (!parsed) throw new Error("invalid_token");
  return { accessToken, instanceUrl: parsed.instanceUrl };
}

const IMAGE_EXTS_PROXY = new Set(["png","jpg","jpeg","gif","webp","bmp","ico","tiff"]);

function buildUploadEmbed(ext: string, filename: string, mode: "link" | "inline"): string {
  if (mode === "inline" && IMAGE_EXTS_PROXY.has(ext))
    return `<p><ac:image><ri:attachment ri:filename="${filename}"/></ac:image></p>`;
  if (mode === "inline" && ext === "drawio") {
    const diagramName = filename.replace(/\.[^.]+$/, "");
    return `<p><ac:structured-macro ac:name="drawio" ac:schema-version="1">` +
      `<ac:parameter ac:name="border">true</ac:parameter>` +
      `<ac:parameter ac:name="diagramName">${diagramName}</ac:parameter>` +
      `<ac:parameter ac:name="revision">1</ac:parameter>` +
      `<ac:parameter ac:name="diagramWidth">1000</ac:parameter>` +
      `<ac:parameter ac:name="height">700</ac:parameter>` +
      `</ac:structured-macro></p>`;
  }
  return `<p><ri:attachment ri:filename="${filename}"/></p>`;
}

/** POST /upload/:pageId — upload binary file as attachment, optionally embed in page body */
app.post("/upload/:pageId", async (c) => {
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return c.json({ error: "unauthorized" }, 401);
  let accessToken: string; let instanceUrl: string;
  try { ({ accessToken, instanceUrl } = await getAtlassianCreds(token, c.env)); }
  catch (e) { return c.json({ error: "auth_error", message: String(e) }, 401); }
  const pageId = c.req.param("pageId");
  const embed = c.req.query("embed") ?? "auto";
  const position = (c.req.query("position") ?? "append") as "append" | "prepend";
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
  const comment = (formData.get("comment") as string | null) ?? "";
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  const base = instanceUrl.replace(/\/$/, "");
  const uploadForm = new FormData();
  uploadForm.append("file", new Blob([fileBytes], { type: fileField.type || "application/octet-stream" }), filename);
  if (comment) uploadForm.append("comment", comment);
  const uploadRes = await fetch(`${base}/rest/api/content/${pageId}/child/attachment`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "X-Atlassian-Token": "no-check", Accept: "application/json" },
    body: uploadForm,
  });
  if (!uploadRes.ok) { const e = await uploadRes.text(); return c.json({ error: "atlassian_upload_failed", status: uploadRes.status, detail: e.slice(0, 400) }, 502); }
  const uploadResult = await uploadRes.json() as { results?: Array<{ id: string; title: string }> };
  const attachment = uploadResult.results?.[0];
  const resolvedEmbed = embed === "auto" ? (IMAGE_EXTS_PROXY.has(ext) ? "inline" : ext === "drawio" ? "inline" : "link") : embed;
  let pageUpdated = false; let pageVersion: number | undefined;
  if (resolvedEmbed !== "none" && attachment) {
    const markup = buildUploadEmbed(ext, filename, resolvedEmbed as "link" | "inline");
    if (markup) {
      try { const { newVersion } = await insertIntoPageBody(accessToken, instanceUrl, pageId, markup, position); pageUpdated = true; pageVersion = newVersion; }
      catch (e) { console.error("[upload] embed failed:", e); }
    }
  }
  return c.json({ action: "attachment_created", page_id: pageId, filename, attachment_id: attachment?.id, size_bytes: fileBytes.byteLength, page_updated: pageUpdated, page_version: pageVersion });
});

/** PUT /upload/:pageId/:attachmentId — update binary data of existing attachment */
app.put("/upload/:pageId/:attachmentId", async (c) => {
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return c.json({ error: "unauthorized" }, 401);
  let accessToken: string; let instanceUrl: string;
  try { ({ accessToken, instanceUrl } = await getAtlassianCreds(token, c.env)); }
  catch (e) { return c.json({ error: "auth_error", message: String(e) }, 401); }
  const pageId = c.req.param("pageId"); const attachmentId = c.req.param("attachmentId");
  let formData: FormData;
  try { formData = await c.req.formData(); }
  catch { return c.json({ error: "invalid_multipart" }, 400); }
  const fileField = formData.get("file");
  if (!fileField || !(fileField instanceof File)) return c.json({ error: "missing_file" }, 400);
  const fileBytes = await fileField.arrayBuffer();
  if (fileBytes.byteLength > MAX_UPLOAD_BYTES) return c.json({ error: "file_too_large", max_mb: 20 }, 413);
  const base = instanceUrl.replace(/\/$/, "");
  const updateForm = new FormData();
  updateForm.append("file", new Blob([fileBytes], { type: fileField.type || "application/octet-stream" }), fileField.name);
  const updateRes = await fetch(`${base}/rest/api/content/${pageId}/child/attachment/${attachmentId}/data`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "X-Atlassian-Token": "no-check", Accept: "application/json" },
    body: updateForm,
  });
  if (!updateRes.ok) { const e = await updateRes.text(); return c.json({ error: "atlassian_error", status: updateRes.status, detail: e.slice(0, 400) }, 502); }
  return c.json({ action: "attachment_updated", page_id: pageId, attachment_id: attachmentId, size_bytes: fileBytes.byteLength });
});

app.notFound((c) => c.json({ error: "not_found" }, 404));
export default app;
