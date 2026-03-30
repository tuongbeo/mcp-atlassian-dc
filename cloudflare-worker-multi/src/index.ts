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

// ── RFC 9728: Claude.ai constructs /.well-known/oauth-protected-resource/{path}
// For resource https://host/jira/mcp → fetches /.well-known/oauth-protected-resource/jira/mcp
// For resource https://host/confluence/mcp → fetches /.well-known/oauth-protected-resource/confluence/mcp
// These must return authorization_servers pointing to the correct per-service issuer.
app.get("/.well-known/oauth-protected-resource/jira/mcp", (c) =>
  c.json(buildResourceMetadata(`${c.env.PUBLIC_BASE_URL}/jira`, "/mcp")));

app.get("/.well-known/oauth-protected-resource/confluence/mcp", (c) =>
  c.json(buildResourceMetadata(`${c.env.PUBLIC_BASE_URL}/confluence`, "/mcp")));

// Root fallback (RFC 9728 step 2)
app.get("/.well-known/oauth-protected-resource", (c) => {
  const base = c.env.PUBLIC_BASE_URL;
  return c.json({
    resource: base,
    authorization_servers: [base],
    scopes_supported: ["READ", "WRITE"],
    bearer_methods_supported: ["header"],
  });
});

// Root OAuth server discovery — generic fallback only
app.get("/.well-known/oauth-authorization-server", (c) => {
  const base = c.env.PUBLIC_BASE_URL;
  return c.json({
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    scopes_supported: ["READ", "WRITE"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
    code_challenge_methods_supported: ["S256"],
  });
});

// ── Per-service OAuth discovery + authorize ────────────────────────────────────
const services: ServiceType[] = ["jira", "confluence"];
for (const svc of services) {
  // Per-service discovery — returned by authorization_servers in resource metadata
  // RFC 8414: supports both path patterns:
  //   /{svc}/.well-known/oauth-authorization-server  (issuer-path-appended)
  //   /.well-known/oauth-authorization-server/{svc}  (path-inserted, used by Claude.ai)
  app.get(`/${svc}/.well-known/oauth-authorization-server`, (c) =>
    c.json(buildOAuthMetadata(`${c.env.PUBLIC_BASE_URL}/${svc}`, c.env.PUBLIC_BASE_URL)));
  app.get(`/.well-known/oauth-authorization-server/${svc}`, (c) =>
    c.json(buildOAuthMetadata(`${c.env.PUBLIC_BASE_URL}/${svc}`, c.env.PUBLIC_BASE_URL)));
  app.get(`/${svc}/.well-known/oauth-protected-resource`, (c) =>
    c.json(buildResourceMetadata(`${c.env.PUBLIC_BASE_URL}/${svc}`, "/mcp")));

  // Per-service authorize — called directly from authorization_endpoint
  app.get(`/${svc}/authorize`, async (c) =>
    handleAuthorize(c.req.raw, c.env, svc));

  // Per-service token alias
  app.post(`/${svc}/token`, async (c) => handleToken(c.req.raw, c.env));
}

// ── Shared OAuth endpoints ─────────────────────────────────────────────────────
app.get(CALLBACK_PATH, async (c) => handleCallback(c.req.raw, c.env));
app.post("/token", async (c) => handleToken(c.req.raw, c.env));

// Root /authorize — kept as fallback, should rarely be called now
app.get("/authorize", async (c) => {
  // Parse service from client_id as last resort only
  const { parseClientId } = await import("./types");
  const clientId = c.req.query("client_id") ?? "";
  const parsed = parseClientId(clientId);
  const url = parsed?.instanceUrl.toLowerCase() ?? "";
  const svc: ServiceType = (url.includes("confluence") || url.includes("cms") || url.includes("wiki"))
    ? "confluence" : "jira";
  return handleAuthorize(c.req.raw, c.env, svc);
});

// ── DCR — no-op ────────────────────────────────────────────────────────────────
app.post("/register", async (c) => {
  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch { /* ok */ }
  return c.json({
    client_id:     (body.client_id as string)     ?? crypto.randomUUID(),
    client_secret: (body.client_secret as string) ?? crypto.randomUUID(),
    redirect_uris: body.redirect_uris ?? [],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
  }, 201);
});

// ── MCP endpoints ─────────────────────────────────────────────────────────────
async function mcpHandler(req: Request, env: Env, svc: ServiceType): Promise<Response> {
  const auth  = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const svcBase = `${env.PUBLIC_BASE_URL}/${svc}`;

  // No token at all — prompt full authorization
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

  // Bug fix: include error="invalid_token" so Claude.ai knows to use refresh_token
  // instead of prompting the user to re-connect from scratch (RFC 6750 §3.1).
  if (!payload) return new Response(
    JSON.stringify({ error: "invalid_token", error_description: "Token invalid or expired." }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": [
          `Bearer realm="${svcBase}"`,
          `error="invalid_token"`,
          `error_description="Token expired"`,
          `resource_metadata_url="${svcBase}/.well-known/oauth-protected-resource"`,
        ].join(", "),
      },
    }
  );

  return handleMcpRequest(req, env, svc);
}

app.all("/jira/mcp",       async (c) => mcpHandler(c.req.raw, c.env, "jira"));
app.all("/confluence/mcp", async (c) => mcpHandler(c.req.raw, c.env, "confluence"));

// ── 404 ───────────────────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app;
