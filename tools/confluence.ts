/**
 * Confluence Data Center MCP Tools (25 tools).
 * Phase 2 adds (+3): confluence_add_content, confluence_list_page_files, confluence_delete_file
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { confluenceRequest, atlassianMultipartRequest, insertIntoPageBody } from "../shared/atlassian";
import { MAX_UPLOAD_BYTES } from "../shared/types";

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
  space_key: z.string(), title: z.string(),
  content: z.string().describe("Confluence Storage Format (XHTML). E.g. '<p>Hello</p>'"),
  parent_id: z.string().optional(),
});
const UpdatePageInput = z.object({
  page_id: z.string(), title: z.string(),
  content: z.string().describe("New content in Confluence Storage Format"),
  version: z.number().int().describe("Current version number — tool increments automatically"),
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
const DeleteInput = z.object({ page_id: z.string() });
const ChildrenInput = z.object({
  page_id: z.string(),
  limit: z.number().int().min(1).max(50).default(25),
  depth: z.number().int().min(1).max(5).default(1).optional(),
});
const ConfluenceCommentsInput = z.object({
  page_id: z.string(), action: z.enum(["get", "add"]).default("get"),
  comment: z.string().optional(),
});
const ConfluenceLabelsInput = z.object({
  page_id: z.string(), action: z.enum(["get", "add", "remove"]).default("get"),
  labels: z.array(z.string()).optional(),
});
const ConfluenceHistoryInput = z.object({
  page_id: z.string(), detail: z.enum(["summary", "versions"]).default("summary"),
  limit: z.number().int().min(1).max(50).default(10).optional(),
});
const ConfluenceRestrictionsInput = z.object({
  page_id: z.string(),
  restrictions: z.array(z.object({
    operation: z.enum(["read", "update"]),
    users: z.array(z.string()).optional(),
    groups: z.array(z.string()).optional(),
  })).optional(),
});
const MovePageInput = z.object({
  page_id: z.string(), new_parent_id: z.string().optional(),
  new_space_key: z.string().optional(), new_title: z.string().optional(),
});
const CopyPageInput = z.object({
  source_page_id: z.string(), new_title: z.string(),
  destination_space_key: z.string().optional(), destination_parent_id: z.string().optional(),
});
const GetDrawioDiagramInput = z.object({
  page_id: z.string(), diagram_index: z.number().int().min(0).default(0),
});
const UpdateDrawioDiagramInput = z.object({
  page_id: z.string(), diagram_xml: z.string(), diagram_index: z.number().int().min(0).default(0),
});
const GetContentPropertiesInput = z.object({ page_id: z.string() });
const SetContentPropertyInput = z.object({
  page_id: z.string(), key: z.string(), value: z.unknown(),
});
const SearchUsersInput = z.object({
  query: z.string(), limit: z.number().int().min(1).max(50).default(10),
});
const ConfluenceSpaceActivityInput = z.object({
  space_key: z.string(), start_date: z.string().optional(), end_date: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(25).optional(),
});
const AddContentInput = z.object({
  page_id: z.string().describe("Numeric Confluence page ID"),
  filename: z.string().describe(
    "Filename with extension — auto-routes by type:\n" +
    "• .mmd/.mermaid + content → Mermaid macro in page body\n" +
    "• .drawio + content → XML stored in content property + drawio macro (custContentId)\n" +
    "• .drawio no content → proxy URL; Worker embeds drawio macro after upload\n" +
    "• .png/.jpg/.gif/.webp → proxy URL with inline image embed\n" +
    "• Text files (.md .csv .json .ts .py etc.) + content → text attachment\n" +
    "• Binary (.pdf .xlsx .docx .zip) → proxy URL with link embed"
  ),
  content: z.string().optional().describe("Text content. Omit for binary → proxy URL."),
  storage_mode: z.enum(["auto","attachment","macro","property"]).default("auto").optional(),
  visibility: z.enum(["auto","none","link","inline"]).default("auto").optional(),
  position: z.enum(["append","prepend"]).default("append").optional(),
  property_key: z.string().optional().describe("Required when storage_mode='property'."),
  comment: z.string().optional(),
  overwrite: z.boolean().default(false).optional(),
});
const CreateDrawioDiagramInput = z.object({
  page_id: z.string().describe("Numeric Confluence page ID"),
  diagram_name: z.string().describe(
    "Semantic name without extension. E.g. 'login-flow', 'c4-ndakey-container'. " +
    "Will become the attachment filename and macro diagramName reference."
  ),
  diagram_type: z.enum([
    "activity", "bpmn", "usecase", "sequence",
    "er", "dfd", "c4_context", "c4_container", "c4_component"
  ]).describe("Diagram type — determines which Regional Rules to apply when generating XML."),
  diagram_xml: z.string().describe(
    "Complete mxGraphModel XML. Must NOT include <mxfile> wrapper — tool adds it automatically. " +
    "Follow DRAW.IO LAYOUT RULES in this tool description exactly."
  ),
  position: z.enum(["append", "prepend"]).default("append").optional(),
});
const ListPageFilesInput = z.object({
  page_id: z.string(), limit: z.number().int().min(1).max(50).default(25).optional(),
});
const DeleteFileInput = z.object({
  page_id: z.string(), attachment_id: z.string().describe("Numeric attachment ID"),
});

export function registerConfluenceTools(server: McpServer, getCreds: GetCreds, workerBaseUrl = ""): void {

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
      return ok(await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}?expand=${p.expand}`));
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
        type: "page", title: p.title, space: { key: p.space_key },
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

  server.registerTool("confluence_get_page_children", {
    title: "Get Child Pages",
    description: "Get child pages. Use depth>1 for recursive tree (max depth=5).",
    inputSchema: ChildrenInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const tree = await getChildrenRecursive(accessToken, instanceUrl, p.page_id, 1, p.depth ?? 1, p.limit);
      return ok({ page_id: p.page_id, children: tree });
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_comments", {
    title: "Get or Add Page Comments",
    description: "Get comments (action=get) or add a comment (action=add).",
    inputSchema: ConfluenceCommentsInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      if (p.action === "get") {
        const data = await confluenceRequest(accessToken, instanceUrl,
          `/content/${p.page_id}/child/comment?expand=body.view,version&limit=25`) as { results: unknown[] };
        return ok({ comments: data.results });
      }
      if (!p.comment) return err(new Error("comment is required when action=add"));
      return ok(await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}/child/comment`, "POST", {
          type: "comment",
          body: { storage: { value: `<p>${p.comment}</p>`, representation: "storage" } },
        }));
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_labels", {
    title: "Manage Page Labels",
    description: "Get, add, or remove labels on a page.",
    inputSchema: ConfluenceLabelsInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      if (p.action === "get") return ok(await confluenceRequest(accessToken, instanceUrl, `/content/${p.page_id}/label`));
      if (!p.labels?.length) return err(new Error("labels array required for add/remove"));
      if (p.action === "add") {
        return ok(await confluenceRequest(accessToken, instanceUrl, `/content/${p.page_id}/label`, "POST",
          p.labels.map(name => ({ prefix: "global", name }))));
      }
      const results: string[] = [];
      for (const label of p.labels) {
        await confluenceRequest(accessToken, instanceUrl,
          `/content/${p.page_id}/label?name=${encodeURIComponent(label)}`, "DELETE");
        results.push(`Removed: ${label}`);
      }
      return ok(results);
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_history", {
    title: "Get Page History",
    description: "Get page history. detail=summary or detail=versions.",
    inputSchema: ConfluenceHistoryInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      if (p.detail === "summary") {
        const raw = await confluenceRequest(accessToken, instanceUrl, `/content/${p.page_id}/history`) as {
          createdBy?: { displayName?: string }; createdDate?: string;
          lastUpdated?: { by?: { displayName?: string }; when?: string; number?: number };
        };
        return ok({ created_by: raw.createdBy?.displayName, created_date: raw.createdDate,
          last_updated_by: raw.lastUpdated?.by?.displayName, last_updated_when: raw.lastUpdated?.when,
          version_number: raw.lastUpdated?.number });
      }
      const raw = await confluenceRequest(accessToken, instanceUrl,
        `/experimental/content/${p.page_id}/version?limit=${p.limit ?? 10}`) as {
          results?: Array<{ number?: number; by?: { displayName?: string; username?: string }; when?: string; message?: string; minorEdit?: boolean }>;
          size?: number;
        };
      return ok({ total: raw.size, versions: (raw.results ?? []).map(v => ({
        version: v.number, author: v.by?.displayName ?? v.by?.username ?? "Unknown",
        date: v.when, message: v.message ?? "", minor_edit: v.minorEdit ?? false })) });
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_restrictions", {
    title: "Get or Set Page Restrictions",
    description: "Get or set page access restrictions.",
    inputSchema: ConfluenceRestrictionsInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      if (p.restrictions === undefined) {
        const data = await confluenceRequest(accessToken, instanceUrl,
          `/content/${p.page_id}?expand=restrictions.read.restrictions.user,restrictions.read.restrictions.group,restrictions.update.restrictions.user,restrictions.update.restrictions.group`) as { restrictions: unknown };
        return ok(data.restrictions ?? {});
      }
      const buildOp = (op: string) => {
        const opEntry = p.restrictions!.find(r => r.operation === op);
        return { operation: op, restrictions: {
          user: { results: (opEntry?.users ?? []).map(name => ({ type: "known", username: name })) },
          group: { results: (opEntry?.groups ?? []).map(name => ({ type: "group", name })) },
        }};
      };
      await confluenceRequest(accessToken, instanceUrl, `/content/${p.page_id}/restriction`, "PUT",
        [buildOp("read"), buildOp("update")]);
      return ok(p.restrictions.length === 0 ? "All restrictions removed." : "Restrictions set.");
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_move_page", {
    title: "Move Confluence Page",
    description: "Move a page to a new parent or space.",
    inputSchema: MovePageInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const current = await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}?expand=version,space,ancestors`) as {
          version?: { number?: number }; title?: string; space?: { key?: string }; ancestors?: Array<{ id: string }>;
        };
      const body: Record<string, unknown> = {
        type: "page", title: p.new_title ?? current.title,
        version: { number: (current.version?.number ?? 1) + 1 },
        space: { key: p.new_space_key ?? current.space?.key },
      };
      if (p.new_parent_id !== undefined) body.ancestors = p.new_parent_id ? [{ id: p.new_parent_id }] : [];
      else { const anc = current.ancestors ?? []; if (anc.length > 0) body.ancestors = [{ id: anc[anc.length - 1].id }]; }
      return ok(await confluenceRequest(accessToken, instanceUrl, `/content/${p.page_id}`, "PUT", body));
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_copy_page", {
    title: "Copy Confluence Page",
    description: "Copy a page's content to a new location. Child pages are NOT copied.",
    inputSchema: CopyPageInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const source = await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.source_page_id}?expand=body.storage,space`) as {
          body?: { storage?: { value?: string } }; space?: { key?: string };
        };
      const newPage: Record<string, unknown> = {
        type: "page", title: p.new_title,
        space: { key: p.destination_space_key ?? source.space?.key ?? "" },
        body: { storage: { value: source.body?.storage?.value ?? "", representation: "storage" } },
      };
      if (p.destination_parent_id) newPage.ancestors = [{ id: p.destination_parent_id }];
      return ok(await confluenceRequest(accessToken, instanceUrl, "/content", "POST", newPage));
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_get_macro_configs", {
    title: "Get Page Macro Configs",
    description: "Extract all structured macro configurations from a Confluence page body.",
    inputSchema: z.object({ page_id: z.string(), macro_name_filter: z.string().optional() }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const raw = await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}?expand=body.storage`) as { body?: { storage?: { value?: string } } };
      const xhtml = raw?.body?.storage?.value ?? "";
      const normalized = xhtml.replace(/(<ac:structured-macro[^>]*?)\/>/g, "$1></ac:structured-macro>");
      const macros: Array<{ macro_name: string; parameters: Record<string, string> }> = [];
      const macroRe = /<ac:structured-macro[^>]*ac:name="([^"]+)"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g;
      let mm: RegExpExecArray | null;
      while ((mm = macroRe.exec(normalized)) !== null) {
        const macroName = mm[1];
        if (p.macro_name_filter && !macroName.toLowerCase().includes(p.macro_name_filter.toLowerCase())) continue;
        const parameters: Record<string, string> = {};
        const paramRe = /<ac:parameter[^>]*ac:name="([^"]+)"[^>]*>([\s\S]*?)<\/ac:parameter>/g;
        let pm: RegExpExecArray | null;
        while ((pm = paramRe.exec(mm[2])) !== null) parameters[pm[1]] = pm[2].trim();
        macros.push({ macro_name: macroName, parameters });
      }
      return ok({ page_id: p.page_id, macro_count: macros.length, macros });
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_get_drawio_diagram", {
    title: "Get Draw.io Diagram",
    description: "Extract a Draw.io diagram from a Confluence page. Supports inline-XML and custContentId storage formats.",
    inputSchema: GetDrawioDiagramInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const raw = await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}?expand=body.storage`) as { body?: { storage?: { value?: string } } };
      const xhtml = raw?.body?.storage?.value ?? "";
      const normalized = xhtml.replace(/(<ac:structured-macro[^>]*?)\/>/g, "$1></ac:structured-macro>");
      const macroRe = /<ac:structured-macro[^>]*ac:name="drawio"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g;
      const macros: Array<{ index: number; body: string }> = [];
      let m: RegExpExecArray | null; let idx = 0;
      while ((m = macroRe.exec(normalized)) !== null) macros.push({ index: idx++, body: m[1] });
      if (macros.length === 0) return err(new Error("No Draw.io diagram found on this page"));
      if (p.diagram_index >= macros.length) return err(new Error(`Index ${p.diagram_index} out of range — ${macros.length} diagram(s)`));
      const macro = macros[p.diagram_index];
      const params: Record<string, string> = {};
      const paramRe = /<ac:parameter[^>]*ac:name="([^"]+)"[^>]*>([\s\S]*?)<\/ac:parameter>/g;
      let pm: RegExpExecArray | null;
      while ((pm = paramRe.exec(macro.body)) !== null) params[pm[1]] = pm[2].trim();
      const plainBodyMatch = macro.body.match(/<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>/);
      if (plainBodyMatch) return ok({ storage_format: "inline", diagram_index: p.diagram_index,
        diagram_count: macros.length, macro_parameters: params, diagram_xml: plainBodyMatch[1].trim() });
      // diagramName-attachment format (DC native — draw.io DC 14.x / Confluence 9.x default)
      const diagramName = params["diagramName"];
      if (diagramName) {
        try {
          const attachments = await confluenceRequest(accessToken, instanceUrl,
            `/content/${p.page_id}/child/attachment?filename=${encodeURIComponent(diagramName)}&expand=version`) as {
              results?: Array<{ id: string; _links?: { download?: string } }>;
            };
          const attachment = attachments.results?.[0];
          if (attachment?._links?.download) {
            const downloadUrl = `${instanceUrl.replace(/\/$/, "")}${attachment._links.download}`;
            const xmlRes = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
            if (xmlRes.ok) {
              const xml = await xmlRes.text();
              return ok({ storage_format: "diagramName-attachment", diagram_name: diagramName,
                diagram_index: p.diagram_index, diagram_count: macros.length,
                macro_parameters: params, diagram_xml: xml });
            }
          }
        } catch { /* fallthrough to custContentId */ }
      }
      const custId = params["custContentId"];
      if (custId) {
        try {
          const propRaw = await confluenceRequest(accessToken, instanceUrl,
            `/content/${p.page_id}/property/${encodeURIComponent(custId)}`) as { value?: unknown };
          const xml = typeof propRaw.value === "string" ? propRaw.value : JSON.stringify(propRaw.value ?? "");
          return ok({ storage_format: "content_property", diagram_index: p.diagram_index,
            diagram_count: macros.length, macro_parameters: params, content_property_key: custId, diagram_xml: xml });
        } catch { /* fallthrough */ }
      }
      return ok({ storage_format: "unknown", diagram_index: p.diagram_index,
        diagram_count: macros.length, macro_parameters: params, diagram_xml: null });
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_update_drawio_diagram", {
    title: "Update Draw.io Diagram",
    description: "Replace the XML of an inline Draw.io diagram on a page. Works only for inline-XML storage format; for content-property format, use confluence_set_content_property.",
    inputSchema: UpdateDrawioDiagramInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const current = await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}?expand=body.storage,version,title,space`) as {
          version?: { number?: number }; title?: string; space?: { key?: string }; body?: { storage?: { value?: string } };
        };
      const xhtml = current.body?.storage?.value ?? "";
      const normalized = xhtml.replace(/(<ac:structured-macro[^>]*?)\/>/g, "$1></ac:structured-macro>");
      const macroRe = /<ac:structured-macro[^>]*ac:name="drawio"[^>]*>[\s\S]*?<\/ac:structured-macro>/g;
      const matches: Array<{ start: number; end: number; raw: string }> = [];
      let m: RegExpExecArray | null;
      while ((m = macroRe.exec(normalized)) !== null) matches.push({ start: m.index, end: m.index + m[0].length, raw: m[0] });
      if (matches.length === 0) return err(new Error("No Draw.io diagram found"));
      if (p.diagram_index >= matches.length) return err(new Error(`Index ${p.diagram_index} out of range`));
      const target = matches[p.diagram_index];
      if (!target.raw.includes("<ac:plain-text-body>")) return err(new Error("Unsupported Draw.io storage format."));
      const updatedMacro = target.raw.replace(
        /<ac:plain-text-body><!\[CDATA\[[\s\S]*?\]\]><\/ac:plain-text-body>/,
        `<ac:plain-text-body><![CDATA[${p.diagram_xml}]]></ac:plain-text-body>`
      );
      const newXhtml = normalized.slice(0, target.start) + updatedMacro + normalized.slice(target.end);
      return ok(await confluenceRequest(accessToken, instanceUrl, `/content/${p.page_id}`, "PUT", {
        type: "page", title: current.title,
        version: { number: (current.version?.number ?? 1) + 1 }, space: { key: current.space?.key },
        body: { storage: { value: newXhtml, representation: "storage" } },
      }));
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_get_content_properties", {
    title: "Get Page Content Properties",
    description: "List all key-value content properties attached to a Confluence page. Used by plugins (Draw.io stores diagrams via custContentId) and custom integrations.",
    inputSchema: GetContentPropertiesInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const raw = await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}/property?expand=content`) as {
          results?: Array<{ key?: string; value?: unknown; version?: { number?: number } }>; size?: number;
        };
      return ok({ total: raw.size, properties: (raw.results ?? []).map(r => ({ key: r.key, value: r.value, version: r.version?.number })) });
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_set_content_property", {
    title: "Set Page Content Property",
    description: "Create or update a key-value content property on a page. If the key already exists, the property is updated (version auto-incremented).",
    inputSchema: SetContentPropertyInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      let existingVersion: number | null = null;
      try {
        const existing = await confluenceRequest(accessToken, instanceUrl,
          `/content/${p.page_id}/property/${encodeURIComponent(p.key)}`) as { version?: { number?: number } };
        existingVersion = existing.version?.number ?? 1;
      } catch { /* property does not exist */ }
      if (existingVersion !== null) {
        return ok(await confluenceRequest(accessToken, instanceUrl,
          `/content/${p.page_id}/property/${encodeURIComponent(p.key)}`, "PUT",
          { key: p.key, value: p.value, version: { number: existingVersion + 1 } }));
      }
      return ok(await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}/property`, "POST", { key: p.key, value: p.value }));
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_search_users", {
    title: "Search Confluence Users",
    description: "Search Confluence DC users by username, display name, or email prefix.",
    inputSchema: SearchUsersInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const q = p.query.toLowerCase();
      const spaces = await confluenceRequest(accessToken, instanceUrl,
        `/space?type=personal&limit=200`) as { results?: Array<{ key?: string; name?: string }> };
      const matched = (spaces.results ?? [])
        .filter(s => {
          const username = (s.key ?? "").replace(/^~/, "").toLowerCase();
          return username.includes(q) || (s.name ?? "").toLowerCase().includes(q);
        })
        .slice(0, p.limit)
        .map(s => ({ username: (s.key ?? "").replace(/^~/, ""), display_name: s.name }));
      return ok({ total: matched.length, users: matched });
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_get_space_activity", {
    title: "Get Space Activity",
    description: "Get recently modified pages in a Confluence space with author info.",
    inputSchema: ConfluenceSpaceActivityInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      let cql = `space="${p.space_key}" AND type=page`;
      if (p.start_date) cql += ` AND lastModified >= "${p.start_date}"`;
      if (p.end_date) cql += ` AND lastModified <= "${p.end_date}"`;
      cql += " ORDER BY lastModified DESC";
      const data = await confluenceRequest(accessToken, instanceUrl,
        `/content/search?cql=${encodeURIComponent(cql)}&limit=${p.limit ?? 25}&expand=history.lastUpdated,version`) as {
          results: unknown[]; totalSize: number;
        };
      return ok({ space_key: p.space_key, total: data.totalSize, pages: data.results });
    } catch (e) { return err(e); }
  });

  // ── Phase 2: File content tools ───────────────────────────────────────────────

  server.registerTool("confluence_add_content", {
    title: "Add Content to Confluence Page",
    description:
      "Generic content tool. Auto-routes by filename extension:\n" +
      "• .mmd/.mermaid + content → inserts Mermaid macro into page body\n" +
      "• .drawio + content → uploads XML as file attachment + inserts drawio macro (diagramName format)\n" +
      "• .drawio no content → proxy URL; Worker uploads file and inserts drawio macro\n" +
      "• .png/.jpg/.gif/.webp → proxy URL with inline image embed\n" +
      "• Text files (.md .csv .json .ts .py etc.) + content → text attachment\n" +
      "• Binary (.pdf .xlsx .docx .zip etc.) → proxy URL\n" +
      "For binary files, use the returned curl_example to POST directly to the Worker proxy.",
    inputSchema: AddContentInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const ext = (p.filename.split(".").pop() ?? "").toLowerCase();
      const hasContent = typeof p.content === "string" && p.content.length > 0;
      const position = (p.position ?? "append") as "append" | "prepend";

      // ── DC-NATIVE DRAW.IO: upload XML as attachment → insert diagramName macro ──
      // draw.io DC plugin 14.x (Confluence 9.x) only reads diagrams stored as
      // attachments (MIME: application/vnd.jgraph.mxfile) referenced by diagramName.
      // custContentId (content property) format is NOT supported on DC 14.x.
      if (ext === "drawio" && hasContent) {
        const basename = p.filename.replace(/\.[^.]+$/, "");
        const diagramName = `${basename}-${Date.now()}`;
        const base = instanceUrl.replace(/\/$/, "");
        const form = new FormData();
        form.append("file", new Blob([p.content!], { type: "application/vnd.jgraph.mxfile" }), diagramName);
        if (p.comment) form.append("comment", p.comment);
        await atlassianMultipartRequest(accessToken, `${base}/rest/api/content/${p.page_id}/child/attachment`, form);
        const drawioMacro =
          `<ac:structured-macro ac:name="drawio" ac:schema-version="1" ac:macro-id="${crypto.randomUUID()}">` +
          `<ac:parameter ac:name="border">true</ac:parameter>` +
          `<ac:parameter ac:name="diagramName">${diagramName}</ac:parameter>` +
          `<ac:parameter ac:name="revision">1</ac:parameter>` +
          `<ac:parameter ac:name="diagramWidth">1000</ac:parameter>` +
          `<ac:parameter ac:name="height">700</ac:parameter>` +
          `</ac:structured-macro>`;
        const { newVersion } = await insertIntoPageBody(accessToken, instanceUrl, p.page_id, drawioMacro, position);
        return ok({ action: "drawio_attachment_created", filename: p.filename,
          diagram_name: diagramName, page_updated: true, page_version: newVersion });
      }
      // ── END DC-NATIVE DRAW.IO ────────────────────────────────────────────────

      const { storage, visibility } = resolveStorageAndVisibility(
        ext, hasContent, (p.storage_mode ?? "auto") as string, (p.visibility ?? "auto") as string);

      // PROPERTY mode (explicit storage_mode='property' with property_key)
      if (storage === "property") {
        if (!hasContent) return err("content is required for property storage");
        const isDrawioAuto = ext === "drawio" && !p.property_key;
        const propKey = p.property_key ?? `drawio-${Date.now()}-v1`;
        if (!p.property_key && !isDrawioAuto) return err("property_key is required when storage_mode='property'");
        let existingVer: number | null = null;
        try {
          const ex = await confluenceRequest(accessToken, instanceUrl,
            `/content/${p.page_id}/property/${encodeURIComponent(propKey)}`) as { version?: { number?: number } };
          existingVer = ex.version?.number ?? 1;
        } catch { /* new property */ }
        if (existingVer !== null) {
          await confluenceRequest(accessToken, instanceUrl,
            `/content/${p.page_id}/property/${encodeURIComponent(propKey)}`, "PUT",
            { key: propKey, value: p.content, version: { number: existingVer + 1 } });
        } else {
          await confluenceRequest(accessToken, instanceUrl,
            `/content/${p.page_id}/property`, "POST", { key: propKey, value: p.content });
        }
        let pageUpdatedProp = false; let pageVersionProp: number | undefined;
        if (isDrawioAuto && visibility !== "none") {
          const drawioMacro =
            `<ac:structured-macro ac:name="drawio" ac:schema-version="1">` +
            `<ac:parameter ac:name="border">true</ac:parameter>` +
            `<ac:parameter ac:name="custContentId">${propKey}</ac:parameter>` +
            `<ac:parameter ac:name="diagramWidth">900</ac:parameter>` +
            `<ac:parameter ac:name="height">600</ac:parameter>` +
            `</ac:structured-macro>`;
          const { newVersion } = await insertIntoPageBody(accessToken, instanceUrl, p.page_id, drawioMacro, position);
          pageUpdatedProp = true; pageVersionProp = newVersion;
        }
        return ok({ action: "property_set", filename: p.filename, key: propKey,
          page_updated: pageUpdatedProp, page_version: pageVersionProp });
      }

      // MACRO mode (.mmd/.mermaid only)
      if (storage === "macro") {
        if (!hasContent) return err("content is required for macro embedding");
        const markup = buildConfluenceMacro(ext, p.content!);
        if (!markup) return err(`No Confluence macro supported for .${ext}`);
        const { newVersion } = await insertIntoPageBody(accessToken, instanceUrl, p.page_id, markup, position);
        return ok({ action: "macro_embedded", filename: p.filename, page_updated: true, page_version: newVersion });
      }

      // PROXY mode (binary files)
      if (storage === "proxy") {
        const embedQ = visibility !== "none" ? `?embed=${visibility}&position=${position}` : "";
        const endpoint = `${workerBaseUrl}/upload/${p.page_id}${embedQ}`;
        return ok({ action: "proxy_upload_required", filename: p.filename, upload_endpoint: endpoint,
          curl_example: `curl -X POST \\\n  -H "Authorization: Bearer YOUR_BEARER_TOKEN" \\\n  -F "file=@${p.filename}" \\\n  "${endpoint}"` });
      }
      return err("Unresolved storage mode");
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_create_drawio_diagram", {
    title: "Create Draw.io Diagram in Confluence",
    description: `Create a draw.io diagram as a Confluence page attachment and embed it via drawio macro.
This is the ONLY working approach for Confluence DC 14.x (draw.io plugin v14+).

## WORKFLOW (handled automatically — do NOT call confluence_add_content separately)

1. Tool wraps diagram_xml in <mxfile host="cms.pila.vn"> and uploads as attachment
2. Tool inserts drawio macro into page body using the returned diagramName
3. Returns { diagram_name, page_updated, page_version }

## XML FORMAT RULES (apply before calling this tool)

Your diagram_xml must be a valid <mxGraphModel> block (without <mxfile> wrapper).
Mandatory attributes: pageWidth="1169" pageHeight="827" grid="0" math="0" shadow="0"

### GENERAL RULES

G-01 CANVAS: pageWidth="1169" pageHeight="827" (A4, ≤6 lanes) or "1654"x"1169" (A3, >6)
G-02 TYPOGRAPHY: title=16px/bold, swimlane-title=13px/bold, lane-header=12px/bold,
     node=11px, edge-guard=10px/italic. Minimum 10px. All nodes: whiteSpace=wrap;html=1.
     Action/container nodes: overflow=hidden.
G-03 COLORS:
     action-primary  fill=#dae8fc stroke=#6c8ebf font=#000000
     action-success  fill=#d5e8d4 stroke=#82b366 font=#000000
     error/failed    fill=#f8cecc stroke=#b85450 font=#000000
     decision        fill=#fff2cc stroke=#d6b656 font=#000000
     title-bar       fill=#1e3a5f font=#ffffff
     lane-header     fill=#f0f0f0 stroke=#000000
     C4-person       fill=#08427B stroke=#052E56 font=#ffffff
     C4-container    fill=#1168BD stroke=#0B4884 font=#ffffff
     external        fill=#999999 stroke=#6b6b6b font=#ffffff
G-04 SIZES: action=160x50px, diamond=60x60px, initial=20x20px, final=24x24px(double=1)
     vertical-gap=40px-min, lane-header-h=30px, title-bar-h=36px
G-05 EDGES: edgeStyle=orthogonalEdgeStyle;rounded=0 always.
     Always declare exitX exitY entryX entryY explicitly.
     cross-lane-right: exitX=1;exitY=0.5 → entryX=0;entryY=0.5
     cross-lane-left:  exitX=0;exitY=0.5 → entryX=1;entryY=0.5
     cross-lane edge parent: MUST be the common ancestor container id (outermost swimlane
       or '1' for root). NEVER use individual lane cell as parent for cross-lane edges.
     loop-back: MUST use <Array as="points"><mxPoint x=".." y=".."/></Array>
     guard-labels on EDGE not inside diamond.
G-06 ALIGNMENT: same-branch nodes align center_x to lane center.
     cross-lane connected nodes must share center_y → perfectly horizontal edge.
     All coordinates multiples of 10px.

### REGIONAL RULES BY diagram_type

activity:
  Outer frame: strokeWidth=2;fillColor=none. Title bar: h=36;fill=#1e3a5f;fontColor=#ffffff.
  Lane headers: h=30;fill=#f0f0f0;fontStyle=1. Divider: w=2;fill=#000000.
  Start: ellipse;aspect=fixed;fillColor=#000000 (20x20).
  Action: rounded=1;arcSize=20;fillColor=#dae8fc;overflow=hidden.
  Decision: rhombus;fillColor=#fff2cc (60x60). Guard on edge: fontStyle=2;fontSize=10.
  End: ellipse;aspect=fixed;double=1;fillColor=#000000 (24x24).
  Fork/Join: fillColor=#000000;strokeColor=#000000;rounded=0;w=180;h=6
             (plain thin black rectangle — DO NOT use shape= stencil; plain filled rect renders correctly).
             Span full lane width. NO label. parent = outer swimlane container id.
  ObjectNode: rounded=0;dashed=1;dashPattern=8 4;fillColor=#fff2cc;strokeColor=#d6b656;
              whiteSpace=wrap;html=1;w=120;h=50;fontSize=11.
              (dashed yellow rectangle = standard UML object node; DO NOT use shape=mxgraph.uml.entity).
              Connect to activities with dashed=1;endArrow=open;endFill=0 edges.
  Loop-back waypoints: route via x=lane_left-25, two mxPoints same-x different-y.
  Cross-lane edges: parent MUST be outer swimlane container id (not individual lane id).

bpmn:
  Pool (outer):  swimlane;horizontal=1;startSize=30;fillColor=#f0f0f0 (label at left).
  Lane (child):  swimlane;horizontal=0;startSize=120;fillColor=#f8f8f8.
  Task: rounded=1;arcSize=10 (100x60). Gateway: rhombus;fillColor=#fff2cc (40x40).
  Event-start: ellipse;strokeWidth=1;fillColor=#ffffff (30x30).
  Event-end: ellipse;strokeWidth=3;fillColor=#000000 (30x30).
  Sequence flow: endArrow=block;endFill=1.
  Message flow: dashed=1;endArrow=open;startArrow=circle;startFill=0;strokeColor=#555555.
               Cross-pool message flow edge parent: MUST be '1' (root), not pool or lane cell.
  Black box pool: swimlane;startSize=30;fillColor=#000000;fontColor=#ffffff.

usecase:
  Boundary: swimlane;startSize=30;rounded=0;strokeWidth=2;fillColor=none.
  Actor: shape=actor;fontSize=11 (40x60, label below).
  UseCase: ellipse;fillColor=#dae8fc;strokeColor=#6c8ebf (140x50).
  Association: endArrow=none;strokeColor=#333333.
  Include: dashed=1;endArrow=open;endFill=0;label='«include»';fontStyle=2.
  Extend:  dashed=1;endArrow=open;endFill=0;label='«extend»';fontStyle=2.
           Direction: extending UC → base UC.
  Generalization: endArrow=block;endFill=0;strokeColor=#333333;strokeWidth=1.5.
                  Direction: child → parent (actor or use case).

sequence:
  Participants — Service/Object: rounded=1;arcSize=10;fillColor=#dae8fc;w=120;h=40.
                  Actor/Person:  shape=mxgraph.uml.actor;fillColor=#dae8fc;strokeColor=#6c8ebf;w=40;h=80
                                 (stickman icon — DO NOT use shape=mxgraph.flowchart.actor which renders as rectangle).
                                 Label placed below box: verticalLabelPosition=bottom;verticalAlign=top.
                  Database:      shape=cylinder3;fillColor=#dae8fc;strokeColor=#6c8ebf;w=100;h=60.
                  External:      rounded=0;fillColor=#f5f5f5;strokeColor=#999999;w=120;h=40.
  Lifeline: edge from participant exitX=0.5;exitY=1 downward (endArrow=none;dashed=1;dashPattern=8 4).
  ActivationBox: rounded=0;fillColor=#dae8fc;strokeColor=#6c8ebf;w=12;h=<execution_span_px>.
                 x=lifeline_center-6. Draw AFTER lifeline so it renders above (z-order).
  Sync: endArrow=block;endFill=1 HORIZONTAL (entryY=0.5;exitY=0.5) — no edgeStyle.
  Return: dashed=1;endArrow=open.
  Self-loop: edgeStyle=elbowEdgeStyle;elbow=orthogonal;exitX=1;exitY=0.3;entryX=1;entryY=0.7.
             Offset 40px to the right of lifeline center.
  CombinedFragment: swimlane;startSize=20;fillColor=none;strokeColor=#666666;fontStyle=1;
                    fontSize=10;align=left;spacingLeft=4;collapsible=0.
                    MUST include collapsible=0 — without it the "≡" collapse toggle overlaps and truncates the operator label.
                    Header label: 'alt' / 'loop [condition]' / 'opt' / 'par'.
                    Operand separator: dashed=1;endArrow=none;strokeColor=#aaaaaa.
  Object-spacing: 180px. Message-gap: 40px.

er:
  Entity: shape=table;startSize=30;fillColor=#1e3a5f;fontColor=#ffffff.
  Rows: 25px, alternating #f5f5f5/#ffffff. PK: fontStyle=1 [PK]. FK: fontStyle=2;fontColor=#555555 [FK].
  Relation: edgeStyle=entityRelationEdgeStyle with ERmanyToOne/ERoneToMany.
  Relation label: verb phrase (e.g. 'places','contains'); fontStyle=2;fontSize=9;align=center.
                  Offset: set geometry x=-0.5 to position label above edge midpoint.
  M:N junction entity: same as Entity style, w=160;h=80. ERmanyToOne on both connecting edges.

dfd:
  External: rounded=0;fillColor=#f5f5f5;strokeColor=#666666 (100x50).
  Process: ellipse;fillColor=#dae8fc;strokeColor=#6c8ebf (100x100 L0; 80x80 L1+).
           Label: 'P{n}.{m}\n{Process Name}' — process ID in fontSize=9;fontStyle=1 above name.
  DataStore PRIMARY:  shape=mxgraph.dfd.dataStore (140x40) — requires DFD stencil library loaded.
            FALLBACK: shape=mxgraph.flowchart.stored_data;fillColor=#ffffff;strokeColor=#333333;
                      strokeWidth=2 (140x40) — use when stencil availability is uncertain.
  DataFlow: edgeStyle=orthogonalEdgeStyle;endArrow=block;endFill=1 with label. Never bidirectional.
  Levels: L0=Context (single process ellipse for whole system). L1=Pn.0 (e.g. P1.0, P2.0).
          L2=Pn.m sub-processes (e.g. P1.1, P1.2). Label format: ID\nName.

c4_context:
  Person: rounded=1;arcSize=10;fillColor=#08427B;fontColor=#ffffff (180x80).
          Label: "<b>Name</b><br/>[Person]<br/><font size=\"9\">Description</font>".
  System(focus): rounded=0;fillColor=#1168BD;fontColor=#ffffff (240x100 — larger).
  External: rounded=1;arcSize=5;fillColor=#999999;fontColor=#ffffff (180x80).
  Edge: endArrow=open;endFill=0;endSize=8;strokeColor=#555555;fontSize=9.
  Label: "<b>Name</b><br/><i>[Type]</i><br/>Description"
  Legend block: x=40;y=750 (bottom-left). Items: w=120;h=28;fontStyle=1;fontSize=10.
                Colors: Person=#08427B, System=#1168BD, External=#999999, DB=cylinder3;#1168BD.
                Legend frame: rounded=0;fillColor=none;strokeColor=#cccccc.

c4_container:
  Boundary: swimlane;startSize=24;dashed=1;strokeWidth=2;strokeColor=#888888;fillColor=none;
            fontStyle=1;fontSize=12;align=left;spacingLeft=8;verticalAlign=top;
            label='SystemName [Container Scope]'.
  Container: rounded=0;fillColor=#1168BD;fontColor=#ffffff (220x90).
  Database: shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=15;fillColor=#1168BD;
            fontColor=#ffffff (180x80).
  Person/External: parent='1' (OUTSIDE boundary swimlane). Edge: endArrow=open;endFill=0;endSize=8;strokeColor=#555555.
  Label: "<b>Name</b><br/><i>[Container: Tech]</i><br/>Description"
  All edges: parent='1' (root) regardless of where source/target nodes are parented.
  Legend: same standard as c4_context.
  Branch waypoints: <Array as="points"><mxPoint x="{exitX}" y="{midY}"/>
                    <mxPoint x="{serviceX}" y="{midY}"/></Array>

c4_component:
  Boundary: swimlane;startSize=24;dashed=1;strokeWidth=1;fillColor=#f5f5f5;strokeColor=#aaaaaa.
  Component: rounded=0;fillColor=#85bbf0;strokeColor=#5a9fc2;fontColor=#000000 (180x80).
  Interface: ellipse;fillColor=#ffffff;strokeColor=#000000 (12x12).
             Place at component boundary junction for port-style interfaces.
  Dependency: dashed=1;endArrow=open;endFill=0;strokeColor=#888888.
  External elements: parent='1', placed visually outside boundary swimlane.
  All edges: parent='1' regardless of source/target parent.

### GLOBAL SUPPLEMENTARY SHAPES

G-07 NOTE (all diagram types):
     shape=note;size=15;fillColor=#ffffc0;strokeColor=#aaaaaa;whiteSpace=wrap;html=1;fontSize=10.
     Connect note to element: dashed=1;endArrow=none;strokeColor=#aaaaaa;startArrow=none.

### NON-VIOLATION CONSTRAINTS (never break)

NV-01 fontSize < 10px → PROHIBITED
NV-02 HTML tags when html=0 → PROHIBITED
NV-03 edgeStyle=elbowEdgeStyle or curved → PROHIBITED (exception: sequence self-loop only)
NV-04 Missing exitX/entryX on cross-lane edge → PROHIBITED
NV-05 Guard text inside diamond node → PROHIBITED
NV-06 Loop-back without explicit waypoints → PROHIBITED
NV-07 Node width < 120px with label > 1 word → PROHIBITED
NV-08 overflow=visible on action/container node → PROHIBITED
NV-09 childLayout=stackLayout with cross-lane edges → PROHIBITED
NV-10 Duplicate node id in same diagram → PROHIBITED
NV-11 Missing pageWidth/pageHeight → PROHIBITED
NV-12 Edge source/target is swimlane container → PROHIBITED
NV-13 C4/swimlane boundary edge NOT using parent='1' as edge parent → PROHIBITED
NV-14 DFD DataStore used without either confirmed stencil or FALLBACK style → PROHIBITED
NV-15 CombinedFragment swimlane WITHOUT collapsible=0 → PROHIBITED (collapse icon truncates operator)
NV-16 Actor/Person participant using shape=mxgraph.flowchart.actor → PROHIBITED (renders as rectangle; use shape=mxgraph.uml.actor)
NV-17 Fork/Join bar using shape= stencil (e.g. mxgraph.flowchart.start_1) → PROHIBITED (stencil renders as oval; use plain fillColor=#000000;rounded=0;h=6)
NV-18 ObjectNode using shape=mxgraph.uml.entity → PROHIBITED (renders with diamond icon; use dashed=1;dashPattern=8 4;fillColor=#fff2cc)`,
    inputSchema: CreateDrawioDiagramInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const mxfileXml =
        `<mxfile host="cms.pila.vn">` +
        `<diagram id="diag1" name="Page-1">` +
        p.diagram_xml +
        `</diagram></mxfile>`;
      const diagramName = `${p.diagram_name}-${Date.now()}`;
      const base = instanceUrl.replace(/\/$/, "");
      const form = new FormData();
      form.append(
        "file",
        new Blob([mxfileXml], { type: "application/vnd.jgraph.mxfile" }),
        diagramName
      );
      await atlassianMultipartRequest(
        accessToken,
        `${base}/rest/api/content/${p.page_id}/child/attachment`,
        form
      );
      const macro =
        `<ac:structured-macro ac:name="drawio" ac:schema-version="1" ac:macro-id="${crypto.randomUUID()}">` +
        `<ac:parameter ac:name="border">true</ac:parameter>` +
        `<ac:parameter ac:name="diagramName">${diagramName}</ac:parameter>` +
        `<ac:parameter ac:name="revision">1</ac:parameter>` +
        `<ac:parameter ac:name="diagramWidth">1000</ac:parameter>` +
        `<ac:parameter ac:name="height">700</ac:parameter>` +
        `</ac:structured-macro>`;
      const { newVersion } = await insertIntoPageBody(
        accessToken, instanceUrl, p.page_id, macro,
        (p.position ?? "append") as "append" | "prepend"
      );
      return ok({
        action: "drawio_diagram_created",
        diagram_name: diagramName,
        page_updated: true,
        page_version: newVersion,
      });
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_list_page_files", {
    title: "List Files on Confluence Page",
    description: "List all files attached to a page: filename, size, MIME type, version, author, download URL.",
    inputSchema: ListPageFilesInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const data = await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}/child/attachment?limit=${p.limit ?? 25}&expand=version,metadata`) as {
          results?: Array<{
            id: string; title: string;
            metadata?: { mediaType?: string };
            extensions?: { fileSize?: number };
            version?: { number?: number; by?: { displayName?: string; username?: string }; when?: string };
            _links?: { download?: string; thumbnail?: string };
          }>; totalSize?: number; size?: number;
        };
      const files = (data.results ?? []).map(a => ({
        attachment_id: a.id, filename: a.title,
        mime_type: a.metadata?.mediaType ?? "application/octet-stream",
        size_bytes: a.extensions?.fileSize,
        version: a.version?.number,
        author: a.version?.by?.displayName ?? a.version?.by?.username ?? "Unknown",
        updated: a.version?.when,
        download_url: a._links?.download ? `${instanceUrl.replace(/\/$/, "")}${a._links.download}` : undefined,
        thumbnail_url: a._links?.thumbnail ? `${instanceUrl.replace(/\/$/, "")}${a._links.thumbnail}` : undefined,
      }));
      return ok({ page_id: p.page_id, total: data.totalSize ?? data.size ?? files.length, files });
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_delete_file", {
    title: "Delete File from Confluence Page",
    description: "Delete an attachment by ID. WARNING: deletes ALL versions — cannot be undone. Get attachment_id from confluence_list_page_files.",
    inputSchema: DeleteFileInput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}/child/attachment/${p.attachment_id}`, "DELETE");
      return ok({ deleted: true, attachment_id: p.attachment_id, page_id: p.page_id });
    } catch (e) { return err(e); }
  });
}

// ── Recursive children helper ─────────────────────────────────────────────────

async function getChildrenRecursive(
  accessToken: string, instanceUrl: string, pageId: string,
  currentDepth: number, maxDepth: number, limit: number,
): Promise<unknown[]> {
  const data = await confluenceRequest(accessToken, instanceUrl,
    `/content/${pageId}/child/page?limit=${limit}&expand=title,version,space`) as {
      results: Array<{ id: string; title: string; version: { number: number } }>;
    };
  if (currentDepth >= maxDepth || !data.results?.length) return data.results ?? [];
  return Promise.all(data.results.map(async child => ({
    ...child,
    children: await getChildrenRecursive(accessToken, instanceUrl, child.id, currentDepth + 1, maxDepth, limit),
  })));
}

// ── File routing helpers ──────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tiff"]);
const TEXT_EXTS = new Set([
  "md", "txt", "csv", "json", "xml", "html", "svg", "ts", "tsx", "js", "jsx",
  "py", "sh", "bash", "sql", "css", "yaml", "yml", "tf", "toml", "conf", "ini",
  "log", "env", "mmd", "mermaid",
]);

function resolveStorageAndVisibility(
  ext: string, hasContent: boolean, storageOverride: string, visibilityOverride: string
): { storage: "macro" | "attachment" | "property" | "proxy"; visibility: "none" | "link" | "inline" } {
  const toVis = (v: string): "none" | "link" | "inline" =>
    (v === "none" || v === "link" || v === "inline") ? v : "none";
  if (storageOverride === "property") return { storage: "property", visibility: "none" };
  if (storageOverride === "macro") return { storage: "macro", visibility: visibilityOverride !== "auto" ? toVis(visibilityOverride) : "inline" };
  if (storageOverride === "attachment") return { storage: "attachment", visibility: visibilityOverride !== "auto" ? toVis(visibilityOverride) : "none" };
  if (ext === "mmd" || ext === "mermaid") return hasContent ? { storage: "macro", visibility: "inline" } : { storage: "proxy", visibility: "none" };
  // TC03 fix removed: .drawio+content is now handled directly in confluence_add_content
  // via DC-native attachment upload (diagramName format). Only .drawio without content reaches here.
  if (ext === "drawio") return { storage: "proxy", visibility: "inline" };
  if (IMAGE_EXTS.has(ext)) return { storage: "proxy", visibility: visibilityOverride !== "auto" ? toVis(visibilityOverride) : "inline" };
  if (TEXT_EXTS.has(ext) && hasContent) return { storage: "attachment", visibility: visibilityOverride !== "auto" ? toVis(visibilityOverride) : "none" };
  return { storage: "proxy", visibility: visibilityOverride !== "auto" ? toVis(visibilityOverride) : "link" };
}

function buildConfluenceMacro(ext: string, content: string): string {
  if (ext === "mmd" || ext === "mermaid") {
    return `<ac:structured-macro ac:name="mermaiddiagram" ac:schema-version="1">` +
      `<ac:plain-text-body><![CDATA[${content}]]></ac:plain-text-body></ac:structured-macro>`;
  }
  return "";
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}
function err(e: unknown) {
  return { isError: true, content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
}
