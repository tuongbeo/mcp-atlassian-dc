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
import { verifyJWT } from "../../shared/jwt";

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

app.notFound((c) => c.json({ error: "not_found" }, 404));
export default app;
