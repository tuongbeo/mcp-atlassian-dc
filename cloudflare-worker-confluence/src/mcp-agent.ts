/**
 * MCP Server handler — Confluence Data Center only.
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
    if (!creds) throw new Error("Unauthorized: missing or invalid Bearer token. Please re-authorize.");
    return creds; // { accessToken, refreshToken }
  };

  // Confluence worker chỉ cần confluenceUrl
  const getEnvUrls = () => ({ jiraUrl: "", confluenceUrl: env.CONFLUENCE_URL });

  registerConfluenceTools(server, getCreds, getEnvUrls);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: false,
  });

  await server.connect(transport);
  const response = await transport.handleRequest(request);
  await server.close();
  return response;
}
