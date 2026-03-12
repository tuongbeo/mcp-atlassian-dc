/**
 * MCP Server handler — Jira Data Center only.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Env } from "./types";
import { extractSub, getValidAccessToken } from "./jwt";
import { registerJiraTools } from "./tools/jira";

// 401 response chuẩn MCP — Claude.ai sẽ tự trigger OAuth flow lại
function unauthorizedResponse(publicBaseUrl: string): Response {
  return new Response(JSON.stringify({ error: "unauthorized", error_description: "Token expired or revoked. Please re-authenticate." }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": [
        `Bearer realm="${publicBaseUrl}"`,
        `resource_metadata_url="${publicBaseUrl}/.well-known/oauth-protected-resource"`,
      ].join(", "),
    },
  });
}

export async function handleMcpRequest(request: Request, env: Env): Promise<Response> {
  // Pre-validate token trước khi vào MCP handler
  // Nếu fail ở đây → trả HTTP 401 → Claude.ai tự trigger OAuth flow lại
  const sub = await extractSub(request, env.JWT_SECRET);
  if (!sub) return unauthorizedResponse(env.PUBLIC_BASE_URL);

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(
      sub,
      env.ATLASSIAN_OAUTH_CLIENT_ID,
      env.ATLASSIAN_OAUTH_CLIENT_SECRET,
      env.ATLASSIAN_OAUTH_REDIRECT_URI,
      env.OAUTH_KV
    );
  } catch {
    return unauthorizedResponse(env.PUBLIC_BASE_URL);
  }

  const server = new McpServer({ name: "mcp-jira", version: "1.0.0" });

  // getCreds() lúc này chỉ trả token đã validated — không thể fail
  const getCreds = async () => ({ accessToken, refreshToken: "" });

  const getEnvUrls = () => ({ jiraUrl: env.JIRA_URL, confluenceUrl: "" });

  registerJiraTools(server, getCreds, getEnvUrls);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);

  const patchedRequest = new Request(request, {
    headers: (() => {
      const h = new Headers(request.headers);
      const existing = h.get("accept") || "";
      if (!existing.includes("application/json") || !existing.includes("text/event-stream")) {
        h.set("accept", "application/json, text/event-stream");
      }
      return h;
    })(),
  });

  const response = await transport.handleRequest(patchedRequest);
  await server.close();
  return response;
}
