/**
 * MCP Server handler — Jira Data Center only.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Env } from "./types";
import { extractAtlassianCreds } from "./jwt";
import { registerJiraTools } from "./tools/jira";

export async function handleMcpRequest(request: Request, env: Env): Promise<Response> {
  const server = new McpServer({ name: "mcp-jira", version: "1.0.0" });

  const getCreds = async () => {
    const creds = await extractAtlassianCreds(request, env.JWT_SECRET);
    if (!creds) throw new Error("Unauthorized: missing or invalid Bearer token. Please re-authorize.");
    return creds; // { accessToken, refreshToken }
  };

  // Jira worker chỉ cần jiraUrl
  const getEnvUrls = () => ({ jiraUrl: env.JIRA_URL, confluenceUrl: "" });

  registerJiraTools(server, getCreds, getEnvUrls);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: false,
  });

  await server.connect(transport);
  const response = await transport.handleRequest(request);
  await server.close();
  return response;
}
