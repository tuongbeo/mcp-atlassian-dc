/**
 * MCP Server handler sử dụng WebStandardStreamableHTTPServerTransport.
 * Chạy native trên Cloudflare Workers (Web Standard APIs).
 * Stateless mode — không cần Durable Objects hay session management.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Env } from "./types";
import { extractAtlassianCreds } from "./jwt";
import { registerJiraTools } from "./tools/jira";
import { registerConfluenceTools } from "./tools/confluence";

/**
 * Tạo và kết nối MCP server cho mỗi request (stateless).
 * Mỗi request là một instance độc lập — không chia sẻ state.
 */
export async function handleMcpRequest(
  request: Request,
  env: Env
): Promise<Response> {
  // Tạo McpServer mới cho mỗi request
  const server = new McpServer({
    name: "mcp-atlassian",
    version: "1.0.0",
  });

  /**
   * getCreds: đọc proxy JWT từ Authorization header, giải mã Atlassian credentials.
   * Được dùng trong tất cả tool handlers.
   */
  const getCreds = async (): Promise<{ accessToken: string; cloudId: string }> => {
    const creds = await extractAtlassianCreds(request, env.JWT_SECRET);
    if (!creds) {
      throw new Error(
        "Unauthorized: missing or invalid Bearer token. " +
        "Please re-authorize via the OAuth flow."
      );
    }
    return creds;
  };

  const getEnvUrls = (): { jiraUrl: string; confluenceUrl: string } => ({
    jiraUrl: env.JIRA_URL,
    confluenceUrl: env.CONFLUENCE_URL,
  });

  // Đăng ký tools
  registerJiraTools(server, getCreds, getEnvUrls);
  registerConfluenceTools(server, getCreds, getEnvUrls);

  // Tạo transport stateless (sessionIdGenerator: undefined = stateless mode)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — khớp với STATELESS=true của Railway
    enableJsonResponse: false,     // dùng SSE streaming
  });

  // Kết nối server với transport
  await server.connect(transport);

  // Xử lý request và trả về Response
  const response = await transport.handleRequest(request);

  // Đóng server sau khi xử lý xong (quan trọng để tránh memory leak)
  await server.close();

  return response;
}
