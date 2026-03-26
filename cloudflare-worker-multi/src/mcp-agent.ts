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

function unauthorizedResponse(baseUrl: string, svc: ServiceType): Response {
  const base = `${baseUrl}/${svc}`;
  return new Response(JSON.stringify({ error: "unauthorized", error_description: "Token expired. Please re-authenticate." }), {
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

export async function handleMcpRequest(
  request: Request, env: Env, serviceType: ServiceType
): Promise<Response> {
  const sub = await extractSub(request, env.JWT_SECRET);
  if (!sub) return unauthorizedResponse(env.PUBLIC_BASE_URL, serviceType);

  let accessToken: string;
  let instanceUrl: string;

  try {
    accessToken = await getValidAccessToken(sub, env);

    const raw = await env.OAUTH_KV.get(`token:${sub}`, "text");
    if (!raw) return unauthorizedResponse(env.PUBLIC_BASE_URL, serviceType);
    const record: StoredTokenRecord = JSON.parse(raw);

    if (record.serviceType !== serviceType) {
      return new Response(JSON.stringify({
        error: "forbidden",
        error_description: `Token issued for ${record.serviceType}, not ${serviceType}.`,
      }), { status: 403, headers: { "Content-Type": "application/json" } });
    }

    const rawClientId = await decrypt(record.enc_client_id, env.JWT_SECRET);
    if (!rawClientId) return unauthorizedResponse(env.PUBLIC_BASE_URL, serviceType);
    const parsed = parseClientId(rawClientId);
    if (!parsed) return unauthorizedResponse(env.PUBLIC_BASE_URL, serviceType);
    instanceUrl = parsed.instanceUrl;
  } catch (e) {
    console.error("[mcp-agent] Token validation failed:", e);
    return unauthorizedResponse(env.PUBLIC_BASE_URL, serviceType);
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
  return response;
}
