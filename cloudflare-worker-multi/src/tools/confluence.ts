/**
 * Confluence Data Center MCP Tools (22 tools).
 * DC API: {instanceUrl}/rest/api/...
 * Content: Confluence Storage Format (XHTML).
 *
 * Phase 1 changes (30 → 22):
 *   REMOVED:  confluence_get_page_analytics, confluence_get_space_permissions,
 *             confluence_get_attachments, confluence_upload_attachment
 *   MERGED:   confluence_add_comment + confluence_get_page_comments → confluence_comments
 *   MERGED:   confluence_get_labels + confluence_add_label + confluence_remove_label → confluence_labels
 *   MERGED:   confluence_get_page_history + confluence_get_page_versions → confluence_history
 *   MERGED:   confluence_get_page_restrictions + confluence_set_page_restrictions → confluence_restrictions
 *   UPGRADED: confluence_get_page_children (add depth param for recursive tree)
 *   NEW:      confluence_get_space_activity
 *
 * Tool groups:
 *   Search / Read    : confluence_search, confluence_get_page, confluence_get_page_by_title,
 *                      confluence_get_spaces, confluence_get_space_pages, confluence_get_page_children
 *   Write / Lifecycle: confluence_create_page, confluence_update_page, confluence_delete_page,
 *                      confluence_move_page, confluence_copy_page
 *   Comments         : confluence_comments
 *   Labels           : confluence_labels
 *   History          : confluence_history
 *   Restrictions     : confluence_restrictions
 *   Macros           : confluence_get_macro_configs
 *   Draw.io          : confluence_get_drawio_diagram, confluence_update_drawio_diagram
 *   Content Props    : confluence_get_content_properties, confluence_set_content_property
 *   Users            : confluence_search_users
 *   Activity         : confluence_get_space_activity
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { confluenceRequest } from "../atlassian";

type GetCreds = () => Promise<{ accessToken: string; instanceUrl: string }>;

// ── Schemas ───────────────────────────────────────────────────────────────────

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

// ── Merged / upgraded schemas ─────────────────────────────────────────────────

const ChildrenInput = z.object({
  page_id: z.string(),
  limit: z.number().int().min(1).max(50).default(25),
  depth: z.number().int().min(1).max(5).default(1).optional()
    .describe("How many levels deep to retrieve. depth=1 = immediate children only. depth=2+ = recursive tree."),
});

const ConfluenceCommentsInput = z.object({
  page_id: z.string(),
  action: z.enum(["get", "add"]).default("get"),
  comment: z.string().optional().describe("Required when action=add"),
});

const ConfluenceLabelsInput = z.object({
  page_id: z.string(),
  action: z.enum(["get", "add", "remove"]).default("get"),
  labels: z.array(z.string()).optional().describe("Label names. Required for action=add or action=remove"),
});

const ConfluenceHistoryInput = z.object({
  page_id: z.string(),
  detail: z.enum(["summary", "versions"]).default("summary")
    .describe("summary=creation and last update metadata. versions=full version list."),
  limit: z.number().int().min(1).max(50).default(10).optional(),
});

const ConfluenceRestrictionsInput = z.object({
  page_id: z.string(),
  restrictions: z.array(z.object({
    operation: z.enum(["read", "update"]),
    users: z.array(z.string()).optional().describe("Usernames"),
    groups: z.array(z.string()).optional().describe("Group names"),
  })).optional().describe(
    "If omitted, returns current restrictions. If provided (even empty []), sets restrictions."
  ),
});

// ── Move / Copy schemas ───────────────────────────────────────────────────────

const MovePageInput = z.object({
  page_id: z.string().describe("Numeric ID of the page to move"),
  new_parent_id: z.string().optional().describe(
    "Numeric ID of the new parent page. Omit to keep current parent."),
  new_space_key: z.string().optional().describe(
    "Space key to move page into a different space. Omit to keep in current space."),
  new_title: z.string().optional().describe("Optional: rename the page during move."),
});

const CopyPageInput = z.object({
  source_page_id: z.string().describe("Numeric ID of the page to copy"),
  new_title: z.string().describe("Title for the copied page"),
  destination_space_key: z.string().optional().describe("Target space key. Defaults to same space."),
  destination_parent_id: z.string().optional().describe(
    "Numeric ID of the parent in destination space. Omit to place at space root."),
});

// ── Plugin / Property schemas ─────────────────────────────────────────────────

const GetDrawioDiagramInput = z.object({
  page_id: z.string().describe("Numeric page ID"),
  diagram_index: z.number().int().min(0).default(0)
    .describe("0-based index for pages with multiple diagrams"),
});

const UpdateDrawioDiagramInput = z.object({
  page_id: z.string().describe("Numeric page ID"),
  diagram_xml: z.string().describe("New Draw.io diagram XML (mxGraphModel XML string)"),
  diagram_index: z.number().int().min(0).default(0)
    .describe("0-based index for pages with multiple diagrams"),
});

const GetContentPropertiesInput = z.object({
  page_id: z.string().describe("Numeric page ID"),
});

const SetContentPropertyInput = z.object({
  page_id: z.string().describe("Numeric page ID"),
  key: z.string().describe("Property key (alphanumeric, hyphens allowed)"),
  value: z.unknown().describe("Property value — any JSON-serializable data"),
});

const SearchUsersInput = z.object({
  query: z.string().describe("Username, display name, or email prefix"),
  limit: z.number().int().min(1).max(50).default(10),
});

const ConfluenceSpaceActivityInput = z.object({
  space_key: z.string(),
  start_date: z.string().optional().describe("ISO date string, e.g. 2025-01-01"),
  end_date: z.string().optional().describe("ISO date string"),
  limit: z.number().int().min(1).max(50).default(25).optional(),
});

// REMOVED: confluence_get_page_analytics — analytics plugin not installed
// REMOVED: confluence_get_space_permissions — admin-only, not needed in daily workflow
// REMOVED: confluence_get_attachments — blocked by Claude.ai safety filter
// REMOVED: confluence_upload_attachment — blocked by Claude.ai safety filter
// REMOVED: confluence_add_comment — merged into confluence_comments
// REMOVED: confluence_get_page_comments — merged into confluence_comments
// REMOVED: confluence_get_labels — merged into confluence_labels
// REMOVED: confluence_add_label — merged into confluence_labels
// REMOVED: confluence_remove_label — merged into confluence_labels
// REMOVED: confluence_get_page_history — merged into confluence_history
// REMOVED: confluence_get_page_versions — merged into confluence_history
// REMOVED: confluence_get_page_restrictions — merged into confluence_restrictions
// REMOVED: confluence_set_page_restrictions — merged into confluence_restrictions

// ── Tool registration ─────────────────────────────────────────────────────────

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

  server.registerTool("confluence_get_page_children", {
    title: "Get Child Pages",
    description: "Get child pages of a Confluence page. Use depth>1 for recursive tree (max depth=5).",
    inputSchema: ChildrenInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const tree = await getChildrenRecursive(accessToken, instanceUrl, p.page_id, 1, p.depth ?? 1, p.limit);
      return ok({ page_id: p.page_id, children: tree });
    } catch (e) { return err(e); }
  });

  // ── Merged tools ──────────────────────────────────────────────────────────────

  server.registerTool("confluence_comments", {
    title: "Get or Add Page Comments",
    description: "Get comments on a page (action=get) or add a new comment (action=add).",
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
    description: "Manage labels on a Confluence page. Get all labels, add new ones, or remove existing ones.",
    inputSchema: ConfluenceLabelsInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      if (p.action === "get") {
        return ok(await confluenceRequest(accessToken, instanceUrl, `/content/${p.page_id}/label`));
      }
      if (!p.labels?.length) return err(new Error("labels array required for add/remove"));
      if (p.action === "add") {
        const body = p.labels.map(name => ({ prefix: "global", name }));
        return ok(await confluenceRequest(accessToken, instanceUrl,
          `/content/${p.page_id}/label`, "POST", body));
      }
      // remove: DELETE one by one
      const results: string[] = [];
      for (const label of p.labels) {
        await confluenceRequest(accessToken, instanceUrl,
          `/content/${p.page_id}/label?name=${encodeURIComponent(label)}`, "DELETE");
        results.push(`Removed label: ${label}`);
      }
      return ok(results);
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_history", {
    title: "Get Page History",
    description: "Get page history. detail=summary returns created/modified metadata. " +
      "detail=versions returns full version list with authors.",
    inputSchema: ConfluenceHistoryInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      if (p.detail === "summary") {
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
      }
      // versions — uses /experimental/ path (bypassed by confluenceRequest)
      const raw = await confluenceRequest(accessToken, instanceUrl,
        `/experimental/content/${p.page_id}/version?limit=${p.limit ?? 10}`) as {
          results?: Array<{ number?: number; by?: { displayName?: string; username?: string }; when?: string; message?: string; minorEdit?: boolean }>;
          size?: number;
        };
      const versions = (raw.results ?? []).map(v => ({
        version: v.number,
        author: v.by?.displayName ?? v.by?.username ?? "Unknown",
        date: v.when,
        message: v.message ?? "",
        minor_edit: v.minorEdit ?? false,
      }));
      return ok({ total: raw.size, versions });
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_restrictions", {
    title: "Get or Set Page Restrictions",
    description: "Get or set page access restrictions. " +
      "Without restrictions param: returns current. " +
      "With restrictions=[]: removes all restrictions. " +
      "With restrictions=[...]: sets specified users/groups.",
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
        return {
          operation: op,
          restrictions: {
            user: { results: (opEntry?.users ?? []).map(name => ({ type: "known", username: name })) },
            group: { results: (opEntry?.groups ?? []).map(name => ({ type: "group", name })) },
          },
        };
      };
      const body = { results: [buildOp("read"), buildOp("update")] };
      const res = await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}/restriction`, "PUT", body);
      if (p.restrictions.length === 0) return ok("All restrictions removed.");
      return ok(res);
    } catch (e) { return err(e); }
  });

  // ── Page organization tools ───────────────────────────────────────────────────

  server.registerTool("confluence_move_page", {
    title: "Move Confluence Page",
    description: "Move a page to a new parent or a different space. Auto-reads current version and title. " +
      "Reparent within same space: provide new_parent_id only. Move to root: provide new_space_key only.",
    inputSchema: MovePageInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const current = await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}?expand=version,space,ancestors`) as {
          version?: { number?: number }; title?: string;
          space?: { key?: string }; ancestors?: Array<{ id: string }>;
        };
      const body: Record<string, unknown> = {
        type: "page",
        title: p.new_title ?? current.title,
        version: { number: (current.version?.number ?? 1) + 1 },
        space: { key: p.new_space_key ?? current.space?.key },
      };
      if (p.new_parent_id !== undefined) {
        body.ancestors = p.new_parent_id ? [{ id: p.new_parent_id }] : [];
      } else if (p.new_space_key) {
        body.ancestors = [];
      } else {
        const ancestors = current.ancestors ?? [];
        if (ancestors.length > 0) body.ancestors = [{ id: ancestors[ancestors.length - 1].id }];
      }
      return ok(await confluenceRequest(accessToken, instanceUrl, `/content/${p.page_id}`, "PUT", body));
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_copy_page", {
    title: "Copy Confluence Page",
    description: "Copy a page's content and title to a new location. Child pages are NOT copied. Returns the new page object with its ID.",
    inputSchema: CopyPageInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const source = await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.source_page_id}?expand=body.storage,space`) as {
          body?: { storage?: { value?: string } }; space?: { key?: string };
        };
      const spaceKey = p.destination_space_key ?? source.space?.key ?? "";
      const newPage: Record<string, unknown> = {
        type: "page", title: p.new_title,
        space: { key: spaceKey },
        body: { storage: { value: source.body?.storage?.value ?? "", representation: "storage" } },
      };
      if (p.destination_parent_id) newPage.ancestors = [{ id: p.destination_parent_id }];
      return ok(await confluenceRequest(accessToken, instanceUrl, "/content", "POST", newPage));
    } catch (e) { return err(e); }
  });

  // ── Macro / metadata tools ────────────────────────────────────────────────────

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
        `/content/${p.page_id}?expand=body.storage`) as { body?: { storage?: { value?: string } } };
      const xhtml = raw?.body?.storage?.value ?? "";
      const normalized = xhtml.replace(/(<ac:structured-macro[^>]*?)\/>/g, "$1></ac:structured-macro>");
      const macros: Array<{ macro_name: string; parameters: Record<string, string>; decoded_chart_config?: Record<string, unknown> | null }> = [];
      const macroRe = /<ac:structured-macro[^>]*ac:name="([^"]+)"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g;
      let mm: RegExpExecArray | null;
      while ((mm = macroRe.exec(normalized)) !== null) {
        const macroName = mm[1];
        const macroBody = mm[2];
        if (p.macro_name_filter && !macroName.toLowerCase().includes(p.macro_name_filter.toLowerCase())) continue;
        const parameters: Record<string, string> = {};
        const paramRe = /<ac:parameter[^>]*ac:name="([^"]+)"[^>]*>([\s\S]*?)<\/ac:parameter>/g;
        let pm: RegExpExecArray | null;
        while ((pm = paramRe.exec(macroBody)) !== null) parameters[pm[1]] = pm[2].trim();
        let decodedChartConfig: Record<string, unknown> | null = null;
        if (macroName.toLowerCase().includes("customchart") || macroName.toLowerCase().includes("custom-chart")) {
          const chartConfigStr = parameters["chartConfig"] ?? parameters["chart_config"];
          if (chartConfigStr) { try { decodedChartConfig = JSON.parse(chartConfigStr); } catch { /* ignore */ } }
        }
        macros.push({ macro_name: macroName, parameters, ...(decodedChartConfig ? { decoded_chart_config: decodedChartConfig } : {}) });
      }
      return ok({ page_id: p.page_id, macro_count: macros.length, macros });
    } catch (e) { return err(e); }
  });

  // ── Draw.io diagram tools ──────────────────────────────────────────────────────

  server.registerTool("confluence_get_drawio_diagram", {
    title: "Get Draw.io Diagram",
    description: "Extract a Draw.io diagram from a Confluence page. " +
      "Handles both inline XML and content-property storage formats. " +
      "Returns diagram XML, macro parameters, and detected storage format.",
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
      const macros: Array<{ index: number; full: string; body: string }> = [];
      let m: RegExpExecArray | null;
      let idx = 0;
      while ((m = macroRe.exec(normalized)) !== null) macros.push({ index: idx++, full: m[0], body: m[1] });
      if (macros.length === 0) return err(new Error("No Draw.io diagram found on this page"));
      if (p.diagram_index >= macros.length) return err(new Error(`Diagram index ${p.diagram_index} out of range — page has ${macros.length} diagram(s)`));
      const macro = macros[p.diagram_index];
      const paramRe = /<ac:parameter[^>]*ac:name="([^"]+)"[^>]*>([\s\S]*?)<\/ac:parameter>/g;
      const params: Record<string, string> = {};
      let pm: RegExpExecArray | null;
      while ((pm = paramRe.exec(macro.body)) !== null) params[pm[1]] = pm[2].trim();
      const plainBodyMatch = macro.body.match(/<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>/);
      if (plainBodyMatch) {
        return ok({ storage_format: "inline", diagram_index: p.diagram_index, diagram_count: macros.length, macro_parameters: params, diagram_xml: plainBodyMatch[1].trim() });
      }
      const custId = params["custContentId"];
      if (custId) {
        try {
          const propRaw = await confluenceRequest(accessToken, instanceUrl,
            `/content/${p.page_id}/property/${encodeURIComponent(custId)}`) as { value?: unknown };
          const xml = typeof propRaw.value === "string" ? propRaw.value : typeof propRaw.value === "object" ? JSON.stringify(propRaw.value) : String(propRaw.value ?? "");
          return ok({ storage_format: "content_property", diagram_index: p.diagram_index, diagram_count: macros.length, macro_parameters: params, content_property_key: custId, diagram_xml: xml });
        } catch { /* fallthrough */ }
      }
      return ok({ storage_format: "unknown", diagram_index: p.diagram_index, diagram_count: macros.length, macro_parameters: params, diagram_xml: null, note: "Diagram XML could not be extracted." });
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_update_drawio_diagram", {
    title: "Update Draw.io Diagram",
    description: "Replace the XML of a Draw.io diagram on a Confluence page without changing other page content. " +
      "Works only for inline-XML storage format. For content-property format, use confluence_set_content_property.",
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
      if (matches.length === 0) return err(new Error("No Draw.io diagram found on this page"));
      if (p.diagram_index >= matches.length) return err(new Error(`Diagram index ${p.diagram_index} out of range — page has ${matches.length} diagram(s)`));
      const target = matches[p.diagram_index];
      if (!target.raw.includes("<ac:plain-text-body>")) {
        const custIdMatch = target.raw.match(/ac:name="custContentId"[^>]*>([\s\S]*?)<\/ac:parameter>/);
        if (custIdMatch) return err(new Error(`Use confluence_set_content_property with key "${custIdMatch[1].trim()}"`));
        return err(new Error("Unsupported Draw.io storage format."));
      }
      const updatedMacro = target.raw.replace(
        /<ac:plain-text-body><!\[CDATA\[[\s\S]*?\]\]><\/ac:plain-text-body>/,
        `<ac:plain-text-body><![CDATA[${p.diagram_xml}]]></ac:plain-text-body>`
      );
      const newXhtml = normalized.slice(0, target.start) + updatedMacro + normalized.slice(target.end);
      return ok(await confluenceRequest(accessToken, instanceUrl, `/content/${p.page_id}`, "PUT", {
        type: "page", title: current.title,
        version: { number: (current.version?.number ?? 1) + 1 },
        space: { key: current.space?.key },
        body: { storage: { value: newXhtml, representation: "storage" } },
      }));
    } catch (e) { return err(e); }
  });

  // ── Content properties tools ───────────────────────────────────────────────────

  server.registerTool("confluence_get_content_properties", {
    title: "Get Page Content Properties",
    description: "List all key-value content properties attached to a Confluence page. " +
      "Used by plugins (Draw.io stores diagrams via custContentId) and custom integrations.",
    inputSchema: GetContentPropertiesInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const raw = await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}/property?expand=content`) as {
          results?: Array<{ key?: string; value?: unknown; version?: { number?: number } }>;
          size?: number;
        };
      const props = (raw.results ?? []).map(r => ({ key: r.key, value: r.value, version: r.version?.number }));
      return ok({ total: raw.size, properties: props });
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_set_content_property", {
    title: "Set Page Content Property",
    description: "Create or update a key-value content property on a Confluence page. " +
      "If the key already exists, the property is updated (version auto-incremented).",
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
      } catch { /* property does not exist — will create */ }
      if (existingVersion !== null) {
        return ok(await confluenceRequest(accessToken, instanceUrl,
          `/content/${p.page_id}/property/${encodeURIComponent(p.key)}`, "PUT",
          { key: p.key, value: p.value, version: { number: existingVersion + 1 } }));
      }
      return ok(await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}/property`, "POST", { key: p.key, value: p.value }));
    } catch (e) { return err(e); }
  });

  // ── User search tool ───────────────────────────────────────────────────────────

  server.registerTool("confluence_search_users", {
    title: "Search Confluence Users",
    description: "Search Confluence DC users by username, display name, or email prefix. " +
      "Returns username and display name for each match.",
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
          const name = (s.name ?? "").toLowerCase();
          return username.includes(q) || name.includes(q);
        })
        .slice(0, p.limit)
        .map(s => ({ username: (s.key ?? "").replace(/^~/, ""), display_name: s.name, email: null }));
      return ok({ total: matched.length, users: matched });
    } catch (e) { return err(e); }
  });

  // ── New tool: Space Activity ───────────────────────────────────────────────────

  server.registerTool("confluence_get_space_activity", {
    title: "Get Space Activity",
    description: "Get recently modified pages in a Confluence space with author info. " +
      "Use for team contribution reporting and document health monitoring. Optionally filter by date range.",
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
        `/content/search?cql=${encodeURIComponent(cql)}&limit=${p.limit ?? 25}&expand=history.lastUpdated,history.createdBy,version`) as {
          results: unknown[]; totalSize: number;
        };
      return ok({ space_key: p.space_key, total: data.totalSize, pages: data.results });
    } catch (e) { return err(e); }
  });

}

// ── Recursive children helper ─────────────────────────────────────────────────

async function getChildrenRecursive(
  accessToken: string,
  instanceUrl: string,
  pageId: string,
  currentDepth: number,
  maxDepth: number,
  limit: number,
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

// ── Response helpers ──────────────────────────────────────────────────────────

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}
function err(e: unknown) {
  return { isError: true, content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
}
