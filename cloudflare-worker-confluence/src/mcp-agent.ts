/**
 * MCP Server handler — Confluence Data Center only.
 * Inject Accept header để pass validation của WebStandardStreamableHTTPServerTransport.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Env } from "./types";
import { extractSub, getValidAccessToken } from "./jwt";
import { registerConfluenceTools } from "./tools/confluence";

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

  const server = new McpServer({ name: "mcp-confluence", version: "1.0.0" });

  const getCreds = async () => ({ accessToken, refreshToken: "" });

  const getEnvUrls = () => ({ jiraUrl: "", confluenceUrl: env.CONFLUENCE_URL });

  registerConfluenceTools(server, getCreds, getEnvUrls);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });

  await server.connect(transport);

  // Inject Accept header bắt buộc — SDK validate cả application/json và text/event-stream
  // Claude.ai có thể không gửi đúng Accept header
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
