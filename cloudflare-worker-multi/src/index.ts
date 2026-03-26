import { Hono } from "hono";
import { Env, ServiceType } from "./types";
import {
  buildOAuthMetadata, buildResourceMetadata,
  handleAuthorize, handleCallback, handleToken, CALLBACK_PATH,
} from "./oauth";
import { handleMcpRequest } from "./mcp-agent";
import { verifyJWT } from "./jwt";

const app = new Hono<{ Bindings: Env }>();

// ── Health ─────────────────────────────────────────────────────────────────────
app.get("/health", (c) => c.json({
  status: "ok", service: "atlassian", version: "2.0.0",
  jira_mcp: `${c.env.PUBLIC_BASE_URL}/jira/mcp`,
  confluence_mcp: `${c.env.PUBLIC_BASE_URL}/confluence/mcp`,
  timestamp: new Date().toISOString(),
}));

// ── Root-level OAuth discovery (fallback — Claude.ai hits origin root first) ──
// RFC 8414: clients discover metadata at {origin}/.well-known/oauth-authorization-server
// We cannot know which service (jira/confluence) without a hint, so we return
// a combined discovery that covers both services via the same token endpoint.
// Claude.ai will use the authorization_endpoint which embeds service type.
app.get("/.well-known/oauth-authorization-server", (c) => {
  const base = c.env.PUBLIC_BASE_URL;
  return c.json({
    issuer: base,
    // Note: authorization_endpoint is overridden per-service at /jira/authorize etc.
    // Root-level points to jira by default; confluence users should use /confluence/mcp URL.
    authorization_endpoint: `${base}/jira/authorize`,
    token_endpoint: `${base}/token`,
    scopes_supported: ["READ", "WRITE"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
    code_challenge_methods_supported: ["S256"],
  });
});

app.get("/.well-known/oauth-protected-resource", (c) => {
  const base = c.env.PUBLIC_BASE_URL;
  return c.json({
    resource: `${base}/mcp`,
    authorization_servers: [base],
    scopes_supported: ["READ", "WRITE"],
    bearer_methods_supported: ["header"],
  });
});

// ── Per-service OAuth discovery + authorize ────────────────────────────────────
const services: ServiceType[] = ["jira", "confluence"];
for (const svc of services) {
  app.get(`/${svc}/.well-known/oauth-authorization-server`, (c) =>
    c.json(buildOAuthMetadata(`${c.env.PUBLIC_BASE_URL}/${svc}`, c.env.PUBLIC_BASE_URL)));
  app.get(`/${svc}/.well-known/oauth-protected-resource`, (c) =>
    c.json(buildResourceMetadata(`${c.env.PUBLIC_BASE_URL}/${svc}`, "/mcp")));
  app.get(`/${svc}/authorize`, async (c) =>
    handleAuthorize(c.req.raw, c.env, svc));
}

// ── Shared OAuth endpoints ────────────────────────────────────────────────────
app.get(CALLBACK_PATH, async (c) => handleCallback(c.req.raw, c.env));
app.post("/token",     async (c) => handleToken(c.req.raw, c.env));

// ── MCP endpoints ─────────────────────────────────────────────────────────────
async function mcpHandler(req: Request, env: Env, svc: ServiceType): Promise<Response> {
  const auth  = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const svcBase = `${env.PUBLIC_BASE_URL}/${svc}`;

  if (!token) return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": [
        `Bearer realm="${svcBase}"`,
        `resource_metadata_url="${svcBase}/.well-known/oauth-protected-resource"`,
      ].join(", "),
    },
  });

  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return new Response(
    JSON.stringify({ error: "invalid_token", error_description: "Token invalid or expired." }),
    { status: 401, headers: { "Content-Type": "application/json" } }
  );

  return handleMcpRequest(req, env, svc);
}

app.all("/jira/mcp",       async (c) => mcpHandler(c.req.raw, c.env, "jira"));
app.all("/confluence/mcp", async (c) => mcpHandler(c.req.raw, c.env, "confluence"));

// ── 404 ───────────────────────────────────────────────────────────────────────
app.notFound((c) => c.json({
  error: "not_found",
  hint: "client_id format: '{instanceUrl}||{atlassianAppLinkClientId}'",
  endpoints: [
    "GET  /health",
    "GET  /jira/.well-known/oauth-authorization-server",
    "GET  /jira/authorize",
    "GET  /confluence/.well-known/oauth-authorization-server",
    "GET  /confluence/authorize",
    "GET  /callback",
    "POST /token",
    "ALL  /jira/mcp",
    "ALL  /confluence/mcp",
  ],
}, 404));

export default app;
