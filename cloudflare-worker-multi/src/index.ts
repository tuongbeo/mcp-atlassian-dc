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
