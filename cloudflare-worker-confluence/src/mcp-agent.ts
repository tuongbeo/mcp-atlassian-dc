/**
 * MCP Server handler — Confluence Data Center only.
 * Inject Accept header để pass validation của WebStandardStreamableHTTPServerTransport.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Env } from "./types";
import { extractAtlassianCreds } from "./jwt";
import { registerConfluenceTools } from "./tools/confluence";

export async function handleMcpRequest(request: Request, env: Env): Promise<Response> {
  const server = new McpServer({ name: "mcp-confluence", version: "1.0.0" });

  const getCreds = async () => {
    const creds = await extractAtlassianCreds(request, env.JWT_SECRET);
    if (!creds) throw new Error("Unauthorized: missing or invalid Bearer token.");
    return creds;
  };

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
