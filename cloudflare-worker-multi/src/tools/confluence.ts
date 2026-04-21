/**
 * Confluence Data Center MCP Tools (15 tools).
 * DC API: {instanceUrl}/rest/api/...
 * Content: Confluence Storage Format (XHTML).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { confluenceRequest } from "../atlassian";

type GetCreds = () => Promise<{ accessToken: string; instanceUrl: string }>;

const SearchInput = z.object({
  cql: z.string().describe("CQL query. E.g. 'type=page AND space=ENG AND text~\"deploy\"'"),
  limit: z.number().int().min(1).max(50).default(20),
  expand: z.string().default("body.storage,version,space,ancestors"),
});
const PageIdInput = z.object({
  page_id: z.string().describe("Numeric page ID"),
  expand: z.string().default("body.storage,version,ancestors,space,children.page"),
});
const PageByTitleInput = z.object({
  space_key: z.string(),
  title: z.string().describe("Exact page title"),
});
const CreatePageInput = z.object({
  space_key: z.string(),
  title: z.string(),
  content: z.string().describe("Confluence Storage Format (XHTML). E.g. '<p>Hello</p>'"),
  parent_id: z.string().optional(),
});
const UpdatePageInput = z.object({
  page_id: z.string(),
  title: z.string(),
  content: z.string().describe("New content in Confluence Storage Format"),
  version: z.number().int().describe("Current version number from confluence_get_page — the tool will automatically increment it to the next version"),
});
const SpacesInput = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  type: z.enum(["global", "personal"]).optional(),
});
const SpacePagesInput = z.object({
  space_key: z.string(),
  limit: z.number().int().min(1).max(50).default(25),
  start: z.number().int().default(0),
});
const CommentInput = z.object({
  page_id: z.string(),
  comment: z.string(),
});
const ChildrenInput = z.object({
  page_id: z.string(),
  limit: z.number().int().min(1).max(50).default(25),
});
const DeleteInput = z.object({ page_id: z.string() });
const AttachmentsInput = z.object({
  page_id: z.string().describe("Numeric page ID"),
  limit: z.number().int().min(1).max(50).default(25),
});
const UploadAttachmentInput = z.object({
  page_id: z.string().describe("Numeric page ID"),
  filename: z.string().describe("File name including extension"),
  content_base64: z.string().describe("Base64-encoded file content"),
  mime_type: z.string().default("application/octet-stream"),
});
const LabelsInput = z.object({
  page_id: z.string().describe("Numeric page ID"),
});
const AddLabelsInput = z.object({
  page_id: z.string().describe("Numeric page ID"),
  labels: z.array(z.string()).min(1).describe("Label names to add"),
});
const RemoveLabelInput = z.object({
  page_id: z.string().describe("Numeric page ID"),
  label_name: z.string().describe("Label name to remove"),
});

export function registerConfluenceTools(server: McpServer, getCreds: GetCreds): void {

  server.registerTool("confluence_search", {
    title: "Search Confluence",
    description: "Search Confluence using CQL. Returns pages, blog posts, attachments.",
    inputSchema: SearchInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      return ok(await confluenceRequest(accessToken, instanceUrl,
        `/content/search?cql=${encodeURIComponent(p.cql)}&limit=${p.limit}&expand=${p.expand}`));
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_get_page", {
    title: "Get Confluence Page",
    description: "Get page content by numeric ID. Returns body, version, ancestors, child pages.",
    inputSchema: PageIdInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      return ok(await confluenceRequest(accessToken, instanceUrl, `/content/${p.page_id}?expand=${p.expand}`));
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_get_page_by_title", {
    title: "Get Page by Title",
    description: "Find a Confluence page by exact title within a space.",
    inputSchema: PageByTitleInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const cql = `type=page AND space="${p.space_key}" AND title="${p.title}"`;
      return ok(await confluenceRequest(accessToken, instanceUrl,
        `/content/search?cql=${encodeURIComponent(cql)}&expand=body.storage,version,ancestors`));
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_create_page", {
    title: "Create Confluence Page",
    description: "Create a page in Confluence Storage Format (XHTML).",
    inputSchema: CreatePageInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const body: Record<string, unknown> = {
        type: "page", title: p.title,
        space: { key: p.space_key },
        body: { storage: { value: p.content, representation: "storage" } },
      };
      if (p.parent_id) body.ancestors = [{ id: p.parent_id }];
      return ok(await confluenceRequest(accessToken, instanceUrl, "/content", "POST", body));
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_update_page", {
    title: "Update Confluence Page",
    description: "Update page title/content. Version must match current page version.",
    inputSchema: UpdatePageInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      return ok(await confluenceRequest(accessToken, instanceUrl, `/content/${p.page_id}`, "PUT", {
        version: { number: p.version + 1 }, title: p.title, type: "page",
        body: { storage: { value: p.content, representation: "storage" } },
      }));
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_delete_page", {
    title: "Delete Confluence Page",
    description: "Delete a Confluence page. This action cannot be undone.",
    inputSchema: DeleteInput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      await confluenceRequest(accessToken, instanceUrl, `/content/${p.page_id}`, "DELETE");
      return ok(`Page ${p.page_id} deleted.`);
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_get_spaces", {
    title: "List Confluence Spaces",
    description: "List all accessible Confluence spaces. Filter by type: global or personal.",
    inputSchema: SpacesInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      let path = `/space?limit=${p.limit}&expand=description`;
      if (p.type) path += `&type=${p.type}`;
      return ok(await confluenceRequest(accessToken, instanceUrl, path));
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_get_space_pages", {
    title: "List Pages in Space",
    description: "List pages in a Confluence space with pagination.",
    inputSchema: SpacePagesInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      return ok(await confluenceRequest(accessToken, instanceUrl,
        `/space/${p.space_key}/content/page?limit=${p.limit}&start=${p.start}&expand=version,ancestors`));
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_add_comment", {
    title: "Add Confluence Comment",
    description: "Add a comment to a Confluence page.",
    inputSchema: CommentInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      return ok(await confluenceRequest(accessToken, instanceUrl, "/content", "POST", {
        type: "comment", container: { id: p.page_id, type: "page" },
        body: { storage: { value: `<p>${p.comment}</p>`, representation: "storage" } },
      }));
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_get_page_children", {
    title: "Get Child Pages",
    description: "Get child pages of a Confluence page.",
    inputSchema: ChildrenInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      return ok(await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}/child/page?limit=${p.limit}&expand=version`));
    } catch (e) { return err(e); }
  });

  // ── Attachment tools ─────────────────────────────────────────────────────────

  server.registerTool("confluence_get_attachments", {
    title: "Get Page Attachments",
    description: "List all attachments on a Confluence page.",
    inputSchema: AttachmentsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      return ok(await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}/child/attachment?limit=${p.limit}&expand=version`));
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_upload_attachment", {
    title: "Upload Attachment",
    description: "Upload a file attachment to a Confluence page. File content must be base64-encoded.",
    inputSchema: UploadAttachmentInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const bytes = Uint8Array.from(atob(p.content_base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: p.mime_type });
      const form = new FormData();
      form.append("file", blob, p.filename);
      const url = `${instanceUrl.replace(/\/$/, "")}/rest/api/content/${p.page_id}/child/attachment`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Atlassian-Token": "no-check",
        },
        body: form,
      });
      if (!res.ok) throw new Error(`Upload attachment: ${res.status} ${await res.text()}`);
      return ok(await res.json());
    } catch (e) { return err(e); }
  });

  // ── Label tools ──────────────────────────────────────────────────────────────

  server.registerTool("confluence_get_labels", {
    title: "Get Page Labels",
    description: "Get all labels on a Confluence page.",
    inputSchema: LabelsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      return ok(await confluenceRequest(accessToken, instanceUrl, `/content/${p.page_id}/label`));
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_add_label", {
    title: "Add Labels to Page",
    description: "Add one or more labels to a Confluence page.",
    inputSchema: AddLabelsInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const body = p.labels.map((name) => ({ prefix: "global", name }));
      return ok(await confluenceRequest(accessToken, instanceUrl, `/content/${p.page_id}/label`, "POST", body));
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_remove_label", {
    title: "Remove Label from Page",
    description: "Remove a specific label from a Confluence page.",
    inputSchema: RemoveLabelInput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}/label?name=${encodeURIComponent(p.label_name)}`, "DELETE");
      return ok(`Label "${p.label_name}" removed from page ${p.page_id}.`);
    } catch (e) { return err(e); }
  });
  // ── Page metadata tools ──────────────────────────────────────────────────────

  server.registerTool("confluence_get_macro_configs", {
    title: "Get Page Macro Configs",
    description: "Extract all structured macro configurations from a Confluence page body. Useful for reading Custom Charts, Jira Issue macros, etc.",
    inputSchema: z.object({
      page_id: z.string().describe("Numeric page ID"),
      macro_name_filter: z.string().optional().describe("Optional: filter by macro name substring"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const raw = await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}?expand=body.storage`) as {
          body?: { storage?: { value?: string } };
        };
      const xhtml = raw?.body?.storage?.value ?? "";

      const macros: Array<{
        macro_name: string;
        parameters: Record<string, string>;
        decoded_chart_config?: Record<string, unknown> | null;
      }> = [];

      const macroRe = /<ac:structured-macro[^>]*ac:name="([^"]+)"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g;
      const paramRe = /<ac:parameter[^>]*ac:name="([^"]+)"[^>]*>([\s\S]*?)<\/ac:parameter>/g;
      let mm: RegExpExecArray | null;

      while ((mm = macroRe.exec(xhtml)) !== null) {
        const macroName = mm[1];
        const macroBody = mm[2];

        if (p.macro_name_filter && !macroName.toLowerCase().includes(p.macro_name_filter.toLowerCase())) continue;

        const parameters: Record<string, string> = {};
        let pm: RegExpExecArray | null;
        const paramReLocal = new RegExp(paramRe.source, "g");
        while ((pm = paramReLocal.exec(macroBody)) !== null) {
          parameters[pm[1]] = pm[2].trim();
        }

        let decodedChartConfig: Record<string, unknown> | null = null;
        if (macroName.toLowerCase().includes("customchart") || macroName.toLowerCase().includes("custom-chart")) {
          const chartConfigStr = parameters["chartConfig"] ?? parameters["chart_config"];
          if (chartConfigStr) {
            try { decodedChartConfig = JSON.parse(chartConfigStr); } catch { /* ignore */ }
          }
        }

        macros.push({ macro_name: macroName, parameters, ...(decodedChartConfig ? { decoded_chart_config: decodedChartConfig } : {}) });
      }

      return ok({ page_id: p.page_id, macro_count: macros.length, macros });
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_get_page_history", {
    title: "Get Page History",
    description: "Get creation and last update metadata for a Confluence page.",
    inputSchema: z.object({ page_id: z.string().describe("Numeric page ID") }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const raw = await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}/history`) as {
          createdBy?: { displayName?: string };
          createdDate?: string;
          lastUpdated?: { by?: { displayName?: string }; when?: string; message?: string; number?: number };
        };
      return ok({
        created_by: raw.createdBy?.displayName,
        created_date: raw.createdDate,
        last_updated_by: raw.lastUpdated?.by?.displayName,
        last_updated_when: raw.lastUpdated?.when,
        last_updated_message: raw.lastUpdated?.message,
        version_number: raw.lastUpdated?.number,
      });
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_get_page_analytics", {
    title: "Get Page Analytics",
    description: "Get page view analytics if the analytics plugin is available. Returns viewer count or graceful fallback message.",
    inputSchema: z.object({ page_id: z.string().describe("Numeric page ID") }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const base = instanceUrl.replace(/\/$/, "");
      // Try analytics plugin endpoint first
      const analyticsUrl = `${base}/rest/analytics/1.0/content/${p.page_id}/viewers`;
      const res = await fetch(analyticsUrl, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });
      if (res.status === 404) {
        return ok({ page_id: p.page_id, message: "Analytics plugin not available on this instance." });
      }
      if (!res.ok) throw new Error(`Analytics: ${res.status} ${await res.text()}`);
      return ok(await res.json());
    } catch (e) { return err(e); }
  });

}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}
function err(e: unknown) {
  return { isError: true, content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
}
