/**
 * MCP request handler — stateless, one McpServer per request.
 * enableJsonResponse: true → JSON over SSE for better Workers CPU headroom.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Env, ServiceType, StoredTokenRecord } from "./types";
import { extractSub, getValidAccessToken } from "./jwt";
import { decrypt } from "./crypto";
import { parseClientId } from "./types";
import { registerJiraTools } from "./tools/jira";
import { registerConfluenceTools } from "./tools/confluence";

function unauthorizedResponse(baseUrl: string, svc: ServiceType, tokenExpired = false): Response {
  const base = `${baseUrl}/${svc}`;
  const wwwParts = [
    `Bearer realm="${base}"`,
    `resource_metadata_url="${base}/.well-known/oauth-protected-resource"`,
  ];
  // RFC 6750 §3.1: include error="invalid_token" when the token is present but
  // expired/invalid so the client knows to use the refresh_token rather than
  // prompting the user for a full re-authorization.
  if (tokenExpired) {
    wwwParts.push(`error="invalid_token"`);
    wwwParts.push(`error_description="Token expired"`);
  }
  return new Response(
    JSON.stringify({
      error: tokenExpired ? "invalid_token" : "unauthorized",
      error_description: "Token expired. Please re-authenticate.",
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": wwwParts.join(", "),
      },
    }
  );
}

export async function handleMcpRequest(
  request: Request, env: Env, serviceType: ServiceType
): Promise<Response> {
  const sub = await extractSub(request, env.JWT_SECRET);
  if (!sub) return unauthorizedResponse(env.PUBLIC_BASE_URL, serviceType, false);

  let accessToken: string;
  let instanceUrl: string;

  try {
    accessToken = await getValidAccessToken(sub, env);

    const raw = await env.OAUTH_KV.get(`token:${sub}`, "text");
    if (!raw) return unauthorizedResponse(env.PUBLIC_BASE_URL, serviceType, true);
    const record: StoredTokenRecord = JSON.parse(raw);

    if (record.serviceType !== serviceType) {
      return new Response(JSON.stringify({
        error: "forbidden",
        error_description: `Token issued for ${record.serviceType}, not ${serviceType}.`,
      }), { status: 403, headers: { "Content-Type": "application/json" } });
    }

    const rawClientId = await decrypt(record.enc_client_id, env.JWT_SECRET);
    if (!rawClientId) return unauthorizedResponse(env.PUBLIC_BASE_URL, serviceType, true);
    const parsed = parseClientId(rawClientId);
    if (!parsed) return unauthorizedResponse(env.PUBLIC_BASE_URL, serviceType, true);
    instanceUrl = parsed.instanceUrl;
  } catch (e) {
    console.error("[mcp-agent] Token validation failed:", e);
    return unauthorizedResponse(env.PUBLIC_BASE_URL, serviceType, true);
  }

  const server = new McpServer({ name: `atlassian-${serviceType}`, version: "2.0.0" });
  const getCreds = async () => ({ accessToken, instanceUrl });

  if (serviceType === "jira") registerJiraTools(server, getCreds);
  else registerConfluenceTools(server, getCreds);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  const response = await transport.handleRequest(request);
  await server.close();

  // Inject stable Mcp-Session-Id so Claude Cowork can distinguish
  // Jira vs Confluence sessions sharing the same domain.
  // Format: {sub}:{serviceType}  e.g. cms.pila.vn:abc123def456:confluence
  const headers = new Headers(response.headers);
  headers.set("Mcp-Session-Id", `${sub}:${serviceType}`);
  return new Response(response.body, { status: response.status, headers });
}
