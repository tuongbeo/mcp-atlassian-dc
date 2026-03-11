/**
 * Confluence Data Center MCP Tools.
 * DC API: ${CONFLUENCE_URL}/rest/api/...
 * Không có cloud_id, không có ADF.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { confluenceRequest } from "../atlassian";

type GetCreds = () => Promise<{ accessToken: string; refreshToken: string }>;

export function registerConfluenceTools(
  server: McpServer,
  getCreds: GetCreds,
  getEnvUrls: () => { jiraUrl: string; confluenceUrl: string }
): void {

  // ── confluence_search ──────────────────────────────────────────────────────
  server.tool(
    "confluence_search",
    "Search Confluence content using CQL (Confluence Query Language)",
    {
      cql: z.string().describe("CQL query, ví dụ: 'type=page AND space=ENG AND text~\"deployment\"'"),
      limit: z.number().int().min(1).max(50).optional().default(20),
      expand: z.string().optional().default("body.storage,version,space,ancestors"),
    },
    async ({ cql, limit, expand }) => {
      const { accessToken } = await getCreds();
      const { confluenceUrl } = getEnvUrls();
      const data = await confluenceRequest(
        accessToken, confluenceUrl,
        `/content/search?cql=${encodeURIComponent(cql)}&limit=${limit}&expand=${expand}`
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── confluence_get_page ────────────────────────────────────────────────────
  server.tool(
    "confluence_get_page",
    "Get content of a specific Confluence page by ID",
    {
      page_id: z.string().describe("Numeric page ID"),
      expand: z.string().optional().default("body.storage,version,ancestors,space,children.page"),
    },
    async ({ page_id, expand }) => {
      const { accessToken } = await getCreds();
      const { confluenceUrl } = getEnvUrls();
      const data = await confluenceRequest(
        accessToken, confluenceUrl, `/content/${page_id}?expand=${expand}`
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── confluence_create_page ─────────────────────────────────────────────────
  server.tool(
    "confluence_create_page",
    "Create a new Confluence page",
    {
      space_key: z.string().describe("Space key, ví dụ: ENG, PRODUCT"),
      title: z.string().describe("Tiêu đề trang"),
      content: z.string().describe(
        "Nội dung trong Confluence Storage Format (XHTML). Ví dụ: '<p>Hello</p><h2>Section</h2><p>Content</p>'"
      ),
      parent_id: z.string().optional().describe("ID trang cha (để tạo trang con)"),
    },
    async ({ space_key, title, content, parent_id }) => {
      const { accessToken } = await getCreds();
      const { confluenceUrl } = getEnvUrls();
      const body: Record<string, unknown> = {
        type: "page",
        title,
        space: { key: space_key },
        body: { storage: { value: content, representation: "storage" } },
      };
      if (parent_id) body.ancestors = [{ id: parent_id }];
      const data = await confluenceRequest(accessToken, confluenceUrl, "/content", "POST", body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── confluence_update_page ─────────────────────────────────────────────────
  server.tool(
    "confluence_update_page",
    "Update title and/or content of an existing Confluence page",
    {
      page_id: z.string(),
      title: z.string(),
      content: z.string().describe("Nội dung mới trong Confluence Storage Format"),
      version: z.number().int().describe("Version hiện tại (lấy từ confluence_get_page → version.number)"),
    },
    async ({ page_id, title, content, version }) => {
      const { accessToken } = await getCreds();
      const { confluenceUrl } = getEnvUrls();
      const data = await confluenceRequest(
        accessToken, confluenceUrl, `/content/${page_id}`, "PUT",
        {
          version: { number: version },
          title,
          type: "page",
          body: { storage: { value: content, representation: "storage" } },
        }
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── confluence_get_spaces ──────────────────────────────────────────────────
  server.tool(
    "confluence_get_spaces",
    "List all accessible Confluence spaces",
    {
      limit: z.number().int().min(1).max(100).optional().default(50),
      type: z.enum(["global", "personal"]).optional(),
    },
    async ({ limit, type }) => {
      const { accessToken } = await getCreds();
      const { confluenceUrl } = getEnvUrls();
      let path = `/space?limit=${limit}&expand=description`;
      if (type) path += `&type=${type}`;
      const data = await confluenceRequest(accessToken, confluenceUrl, path);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── confluence_get_space_pages ─────────────────────────────────────────────
  server.tool(
    "confluence_get_space_pages",
    "List pages in a specific Confluence space",
    {
      space_key: z.string(),
      limit: z.number().int().min(1).max(50).optional().default(25),
      start: z.number().int().optional().default(0),
    },
    async ({ space_key, limit, start }) => {
      const { accessToken } = await getCreds();
      const { confluenceUrl } = getEnvUrls();
      const data = await confluenceRequest(
        accessToken, confluenceUrl,
        `/space/${space_key}/content/page?limit=${limit}&start=${start}&expand=version,ancestors`
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── confluence_add_comment ─────────────────────────────────────────────────
  server.tool(
    "confluence_add_comment",
    "Add a comment to a Confluence page",
    {
      page_id: z.string(),
      comment: z.string().describe("Nội dung comment (plain text)"),
    },
    async ({ page_id, comment }) => {
      const { accessToken } = await getCreds();
      const { confluenceUrl } = getEnvUrls();
      const data = await confluenceRequest(
        accessToken, confluenceUrl, "/content", "POST",
        {
          type: "comment",
          container: { id: page_id, type: "page" },
          body: { storage: { value: `<p>${comment}</p>`, representation: "storage" } },
        }
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── confluence_get_page_children ───────────────────────────────────────────
  server.tool(
    "confluence_get_page_children",
    "Get child pages of a Confluence page",
    {
      page_id: z.string(),
      limit: z.number().int().min(1).max(50).optional().default(25),
    },
    async ({ page_id, limit }) => {
      const { accessToken } = await getCreds();
      const { confluenceUrl } = getEnvUrls();
      const data = await confluenceRequest(
        accessToken, confluenceUrl,
        `/content/${page_id}/child/page?limit=${limit}&expand=version`
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
