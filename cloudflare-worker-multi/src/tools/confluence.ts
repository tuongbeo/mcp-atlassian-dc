/**
 * Confluence Data Center MCP Tools (30 tools).
 * DC API: {instanceUrl}/rest/api/...
 * Content: Confluence Storage Format (XHTML).
 *
 * Tool groups:
 *   Search / Read    : confluence_search, confluence_get_page, confluence_get_page_by_title,
 *                      confluence_get_spaces, confluence_get_space_pages, confluence_get_page_children,
 *                      confluence_get_page_history, confluence_get_page_analytics
 *   Write / Lifecycle: confluence_create_page, confluence_update_page, confluence_delete_page,
 *                      confluence_move_page, confluence_copy_page
 *   Comments         : confluence_add_comment, confluence_get_page_comments
 *   Attachments      : confluence_get_attachments, confluence_upload_attachment
 *   Labels           : confluence_get_labels, confluence_add_label, confluence_remove_label
 *   Restrictions     : confluence_get_page_restrictions, confluence_set_page_restrictions
 *   Versions         : confluence_get_page_versions
 *   Macros           : confluence_get_macro_configs
 *   Draw.io          : confluence_get_drawio_diagram, confluence_update_drawio_diagram
 *   Content Props    : confluence_get_content_properties, confluence_set_content_property
 *   Users            : confluence_search_users
 *   Space Perms      : confluence_get_space_permissions
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

// ── New tool schemas ──────────────────────────────────────────────────────────

const MovePageInput = z.object({
  page_id: z.string().describe("Numeric ID of the page to move"),
  new_parent_id: z.string().optional().describe(
    "Numeric ID of the new parent page. Omit to keep current parent (combine with new_space_key to place at root of target space)."),
  new_space_key: z.string().optional().describe(
    "Space key to move page into a different space. Omit to keep in current space."),
  new_title: z.string().optional().describe("Optional: rename the page during move. Omit to keep existing title."),
});

const CopyPageInput = z.object({
  source_page_id: z.string().describe("Numeric ID of the page to copy"),
  new_title: z.string().describe("Title for the copied page"),
  destination_space_key: z.string().optional().describe("Target space key. Defaults to same space as source."),
  destination_parent_id: z.string().optional().describe(
    "Numeric ID of the parent page in the destination space. Omit to place at space root."),
});

const GetRestrictionsInput = z.object({
  page_id: z.string().describe("Numeric page ID"),
});

const SetRestrictionsInput = z.object({
  page_id: z.string().describe("Numeric page ID"),
  restrictions: z.array(z.object({
    operation: z.enum(["read", "update"]).describe("Operation to restrict: 'read' or 'update'"),
    usernames: z.array(z.string()).default([]).describe("DC usernames allowed for this operation"),
    group_names: z.array(z.string()).default([]).describe("Group names allowed for this operation"),
  })).describe(
    "Restriction rules per operation. Pass empty array [] to remove all restrictions and make page unrestricted."),
});

const PageVersionsInput = z.object({
  page_id: z.string().describe("Numeric page ID"),
  limit: z.number().int().min(1).max(50).default(25),
  start: z.number().int().default(0),
});

const GetPageCommentsInput = z.object({
  page_id: z.string().describe("Numeric page ID"),
  limit: z.number().int().min(1).max(50).default(25),
  start: z.number().int().default(0),
});

// ── Plugin-aware tool schemas ─────────────────────────────────────────────────

const GetDrawioDiagramInput = z.object({
  page_id: z.string().describe("Numeric page ID"),
  diagram_index: z.number().int().min(0).default(0)
    .describe("0-based index if the page has multiple Draw.io diagrams (default: first diagram)"),
});

const UpdateDrawioDiagramInput = z.object({
  page_id: z.string().describe("Numeric page ID"),
  diagram_xml: z.string().describe("New Draw.io diagram XML (mxGraphModel XML string)"),
  diagram_index: z.number().int().min(0).default(0)
    .describe("0-based index if the page has multiple Draw.io diagrams (default: first diagram)"),
});

const GetContentPropertiesInput = z.object({
  page_id: z.string().describe("Numeric page ID"),
});

const SetContentPropertyInput = z.object({
  page_id: z.string().describe("Numeric page ID"),
  key: z.string().describe("Property key (alphanumeric, hyphens allowed). E.g. 'my-metadata'"),
  value: z.unknown().describe("Property value — any JSON-serializable data"),
});

const SearchUsersInput = z.object({
  query: z.string().describe("Username, display name, or email prefix to search for"),
  limit: z.number().int().min(1).max(50).default(10),
});

const GetSpacePermissionsInput = z.object({
  space_key: z.string().describe("Space key (e.g. 'PT', 'PNK', 'PNS')"),
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
      // BUG-07 FIX: Normalize self-closing macros (<ac:structured-macro ... />) to
      // open/close form so the body regex doesn't accidentally consume the closing
      // tag of a SUBSEQUENT regular macro (e.g. drawio after a self-closing toc).
      const normalized = xhtml.replace(/(<ac:structured-macro[^>]*?)\/>/g, "$1></ac:structured-macro>");

      const macros: Array<{
        macro_name: string;
        parameters: Record<string, string>;
        decoded_chart_config?: Record<string, unknown> | null;
      }> = [];

      const macroRe = /<ac:structured-macro[^>]*ac:name="([^"]+)"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g;
      const paramRe = /<ac:parameter[^>]*ac:name="([^"]+)"[^>]*>([\s\S]*?)<\/ac:parameter>/g;
      let mm: RegExpExecArray | null;

      while ((mm = macroRe.exec(normalized)) !== null) {
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

  // ── Page organization tools ──────────────────────────────────────────────

  server.registerTool("confluence_move_page", {
    title: "Move Confluence Page",
    description: [
      "Move a page to a new parent or a different space.",
      "Auto-reads the current version and title — no need to provide them.",
      "Use cases:",
      "  • Reparent within same space: provide new_parent_id only.",
      "  • Move to root of same space: provide new_parent_id as empty string \"\".",
      "  • Move to different space (keep parent): provide new_space_key + new_parent_id.",
      "  • Move to root of different space: provide new_space_key only.",
      "  • Rename in place: provide new_title only.",
    ].join(" "),
    inputSchema: MovePageInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();

      // Fetch current page metadata (version, title, space, ancestors)
      const current = await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}?expand=version,space,ancestors`) as {
          version?: { number?: number };
          title?: string;
          space?: { key?: string };
          ancestors?: Array<{ id: string }>;
        };

      const body: Record<string, unknown> = {
        type: "page",
        title: p.new_title ?? current.title,
        version: { number: (current.version?.number ?? 1) + 1 },
        space: { key: p.new_space_key ?? current.space?.key },
      };

      // Determine ancestors
      if (p.new_parent_id !== undefined) {
        // Explicit parent: "" means root, any other value is the new parent ID
        body.ancestors = p.new_parent_id ? [{ id: p.new_parent_id }] : [];
      } else if (p.new_space_key) {
        // Moving to different space with no parent specified → root of new space
        body.ancestors = [];
      } else {
        // Same space, same parent — preserve existing direct parent
        const ancestors = current.ancestors ?? [];
        if (ancestors.length > 0) {
          body.ancestors = [{ id: ancestors[ancestors.length - 1].id }];
        }
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

      // Fetch source page body and space
      const source = await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.source_page_id}?expand=body.storage,space`) as {
          body?: { storage?: { value?: string } };
          space?: { key?: string };
        };

      const spaceKey = p.destination_space_key ?? source.space?.key ?? "";
      const newPage: Record<string, unknown> = {
        type: "page",
        title: p.new_title,
        space: { key: spaceKey },
        body: { storage: { value: source.body?.storage?.value ?? "", representation: "storage" } },
      };
      if (p.destination_parent_id) newPage.ancestors = [{ id: p.destination_parent_id }];

      return ok(await confluenceRequest(accessToken, instanceUrl, "/content", "POST", newPage));
    } catch (e) { return err(e); }
  });

  // ── Restrictions tools ────────────────────────────────────────────────────

  server.registerTool("confluence_get_page_restrictions", {
    title: "Get Page Restrictions",
    description: "Get the current read/update restrictions on a Confluence page. Shows which users and groups are explicitly allowed. An empty result means the page inherits space-level permissions (no explicit page restrictions).",
    inputSchema: GetRestrictionsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      return ok(await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}/restriction/byOperation`));
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_set_page_restrictions", {
    title: "Set Page Restrictions",
    description: [
      "Replace all restrictions on a Confluence page.",
      "Pass restrictions: [] to remove all restrictions (page reverts to space-level permissions).",
      "Each entry specifies an operation ('read' or 'update') and the allowed usernames/group names.",
      "Example — restrict page to one user: [{ operation: 'read', usernames: ['tuongpm'], group_names: [] }, { operation: 'update', usernames: ['tuongpm'], group_names: [] }]",
    ].join(" "),
    inputSchema: SetRestrictionsInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();

      if (p.restrictions.length === 0) {
        // DELETE removes all page-level restrictions
        await confluenceRequest(accessToken, instanceUrl,
          `/content/${p.page_id}/restriction`, "DELETE");
        return ok(`All restrictions removed from page ${p.page_id}. Page now inherits space permissions.`);
      }

      const body = p.restrictions.map((r) => ({
        operation: r.operation,
        restrictions: {
          user: { results: r.usernames.map((u) => ({ type: "known", username: u })) },
          group: { results: r.group_names.map((g) => ({ type: "group", name: g })) },
        },
      }));
      return ok(await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}/restriction`, "PUT", body));
    } catch (e) { return err(e); }
  });

  // ── Version history tools ─────────────────────────────────────────────────

  server.registerTool("confluence_get_page_versions", {
    title: "Get Page Version History",
    description: "List version history of a Confluence page in reverse chronological order. Returns version number, author, timestamp, and change message for each version.",
    inputSchema: PageVersionsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const raw = await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}/version?limit=${p.limit}&start=${p.start}`) as {
          results?: Array<{
            number?: number;
            by?: { displayName?: string; username?: string };
            when?: string;
            message?: string;
            minorEdit?: boolean;
          }>;
          size?: number;
          start?: number;
          limit?: number;
        };
      const versions = (raw.results ?? []).map((v) => ({
        version:    v.number,
        author:     v.by?.displayName ?? v.by?.username ?? "Unknown",
        date:       v.when,
        message:    v.message ?? "",
        minor_edit: v.minorEdit ?? false,
      }));
      return ok({ total: raw.size, start: raw.start, limit: raw.limit, versions });
    } catch (e) { return err(e); }
  });

  // ── Enhanced comment tools ────────────────────────────────────────────────

  server.registerTool("confluence_get_page_comments", {
    title: "Get Page Comments",
    description: "List all comments on a Confluence page with author, timestamp, and HTML body. Complements confluence_add_comment for reading existing discussion.",
    inputSchema: GetPageCommentsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const raw = await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}/child/comment?limit=${p.limit}&start=${p.start}&expand=body.view,version`) as {
          results?: Array<{
            id?: string;
            version?: {
              by?: { displayName?: string; username?: string };
              when?: string;
              number?: number;
            };
            body?: { view?: { value?: string } };
          }>;
          size?: number;
        };
      const comments = (raw.results ?? []).map((c) => ({
        id:        c.id,
        author:    c.version?.by?.displayName ?? c.version?.by?.username ?? "Unknown",
        created:   c.version?.when,
        version:   c.version?.number,
        body_html: c.body?.view?.value ?? "",
      }));
      return ok({ total: raw.size, comments });
    } catch (e) { return err(e); }
  });

  // ── Draw.io diagram tools ──────────────────────────────────────────────────

  server.registerTool("confluence_get_drawio_diagram", {
    title: "Get Draw.io Diagram",
    description: [
      "Extract a Draw.io diagram from a Confluence page.",
      "Handles both storage formats used by Draw.io for Confluence DC:",
      "  1. Inline XML: diagram XML stored in <ac:plain-text-body> within the macro.",
      "  2. Content-property reference: diagram stored as a page content property (key = custContentId value).",
      "Returns the diagram XML, macro parameters, and storage format detected.",
    ].join(" "),
    inputSchema: GetDrawioDiagramInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const raw = await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}?expand=body.storage`) as {
          body?: { storage?: { value?: string } };
        };
      const xhtml = raw?.body?.storage?.value ?? "";
      // BUG-07 FIX: normalize self-closing macros before searching
      const normalized = xhtml.replace(/(<ac:structured-macro[^>]*?)\/>/g, "$1></ac:structured-macro>");

      // Find all drawio macros
      const macroRe = /<ac:structured-macro[^>]*ac:name="drawio"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g;
      const macros: Array<{ index: number; full: string; body: string }> = [];
      let m: RegExpExecArray | null;
      let idx = 0;
      while ((m = macroRe.exec(normalized)) !== null) {
        macros.push({ index: idx++, full: m[0], body: m[1] });
      }

      if (macros.length === 0) return err(new Error("No Draw.io diagram found on this page"));
      if (p.diagram_index >= macros.length)
        return err(new Error(`Diagram index ${p.diagram_index} out of range — page has ${macros.length} diagram(s)`));

      const macro = macros[p.diagram_index];

      // Extract parameters
      const paramRe = /<ac:parameter[^>]*ac:name="([^"]+)"[^>]*>([\s\S]*?)<\/ac:parameter>/g;
      const params: Record<string, string> = {};
      let pm: RegExpExecArray | null;
      while ((pm = paramRe.exec(macro.body)) !== null) params[pm[1]] = pm[2].trim();

      // Check for inline XML in plain-text-body
      const plainBodyMatch = macro.body.match(/<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>/);
      if (plainBodyMatch) {
        return ok({
          storage_format: "inline",
          diagram_index: p.diagram_index,
          diagram_count: macros.length,
          macro_parameters: params,
          diagram_xml: plainBodyMatch[1].trim(),
        });
      }

      // Check for content-property reference (custContentId)
      const custId = params["custContentId"];
      if (custId) {
        try {
          const propRaw = await confluenceRequest(accessToken, instanceUrl,
            `/content/${p.page_id}/property/${encodeURIComponent(custId)}`) as { value?: unknown };
          const xml = typeof propRaw.value === "string" ? propRaw.value
            : typeof propRaw.value === "object" ? JSON.stringify(propRaw.value)
            : String(propRaw.value ?? "");
          return ok({
            storage_format: "content_property",
            diagram_index: p.diagram_index,
            diagram_count: macros.length,
            macro_parameters: params,
            content_property_key: custId,
            diagram_xml: xml,
          });
        } catch {
          // fallthrough to returning macro with no XML
        }
      }

      return ok({
        storage_format: "unknown",
        diagram_index: p.diagram_index,
        diagram_count: macros.length,
        macro_parameters: params,
        diagram_xml: null,
        note: "Diagram XML could not be extracted. It may be stored as an attachment or use an unsupported format.",
      });
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_update_drawio_diagram", {
    title: "Update Draw.io Diagram",
    description: [
      "Replace the XML of a Draw.io diagram on a Confluence page without changing other page content.",
      "Works only for inline-XML storage format (most common for older Draw.io versions).",
      "For content-property storage format, use confluence_set_content_property with the custContentId key.",
      "Auto-reads current page version — no need to fetch it first.",
    ].join(" "),
    inputSchema: UpdateDrawioDiagramInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const current = await confluenceRequest(accessToken, instanceUrl,
        `/content/${p.page_id}?expand=body.storage,version,title,space`) as {
          version?: { number?: number };
          title?: string;
          space?: { key?: string };
          body?: { storage?: { value?: string } };
        };

      const xhtml = current.body?.storage?.value ?? "";
      // BUG-07 FIX: normalize self-closing macros so the drawio search regex
      // doesn't skip macros that follow a self-closing macro (e.g. toc).
      const normalized = xhtml.replace(/(<ac:structured-macro[^>]*?)\/>/g, "$1></ac:structured-macro>");

      // Collect all drawio macros with their positions (use normalized for search,
      // but track positions in normalized string and reconstruct from original)
      const macroRe = /<ac:structured-macro[^>]*ac:name="drawio"[^>]*>[\s\S]*?<\/ac:structured-macro>/g;
      const matches: Array<{ start: number; end: number; raw: string }> = [];
      let m: RegExpExecArray | null;
      while ((m = macroRe.exec(normalized)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length, raw: m[0] });
      }

      if (matches.length === 0) return err(new Error("No Draw.io diagram found on this page"));
      if (p.diagram_index >= matches.length)
        return err(new Error(`Diagram index ${p.diagram_index} out of range — page has ${matches.length} diagram(s)`));

      const target = matches[p.diagram_index];

      // Check storage format
      if (!target.raw.includes("<ac:plain-text-body>")) {
        const custIdMatch = target.raw.match(/ac:name="custContentId"[^>]*>([\s\S]*?)<\/ac:parameter>/);
        if (custIdMatch) {
          return err(new Error(
            `This diagram uses content-property storage (custContentId: "${custIdMatch[1].trim()}"). ` +
            `Use confluence_set_content_property with that key instead.`
          ));
        }
        return err(new Error("Unsupported Draw.io storage format — cannot update via this tool."));
      }

      // Replace the CDATA content
      const updatedMacro = target.raw.replace(
        /<ac:plain-text-body><!\[CDATA\[[\s\S]*?\]\]><\/ac:plain-text-body>/,
        `<ac:plain-text-body><![CDATA[${p.diagram_xml}]]></ac:plain-text-body>`
      );

      const newXhtml = normalized.slice(0, target.start) + updatedMacro + normalized.slice(target.end);

      return ok(await confluenceRequest(accessToken, instanceUrl, `/content/${p.page_id}`, "PUT", {
        type: "page",
        title: current.title,
        version: { number: (current.version?.number ?? 1) + 1 },
        space: { key: current.space?.key },
        body: { storage: { value: newXhtml, representation: "storage" } },
      }));
    } catch (e) { return err(e); }
  });

  // ── Content properties tools ───────────────────────────────────────────────

  server.registerTool("confluence_get_content_properties", {
    title: "Get Page Content Properties",
    description: [
      "List all key-value content properties attached to a Confluence page.",
      "Content properties are used by plugins (e.g. Draw.io stores diagrams here via custContentId),",
      "and by custom integrations to store metadata outside the page body.",
    ].join(" "),
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
      const props = (raw.results ?? []).map((r) => ({
        key:     r.key,
        value:   r.value,
        version: r.version?.number,
      }));
      return ok({ total: raw.size, properties: props });
    } catch (e) { return err(e); }
  });

  server.registerTool("confluence_set_content_property", {
    title: "Set Page Content Property",
    description: [
      "Create or update a key-value content property on a Confluence page.",
      "If the key already exists, the property is updated (version is auto-incremented).",
      "If the key is new, a new property is created.",
      "Useful for storing structured metadata, plugin data, or custom flags on a page.",
    ].join(" "),
    inputSchema: SetContentPropertyInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();

      // Check if property already exists to get its current version
      let existingVersion: number | null = null;
      try {
        const existing = await confluenceRequest(accessToken, instanceUrl,
          `/content/${p.page_id}/property/${encodeURIComponent(p.key)}`) as {
            version?: { number?: number };
          };
        existingVersion = existing.version?.number ?? 1;
      } catch {
        // Property does not exist — will create
      }

      if (existingVersion !== null) {
        // Update existing property
        return ok(await confluenceRequest(accessToken, instanceUrl,
          `/content/${p.page_id}/property/${encodeURIComponent(p.key)}`, "PUT", {
            key: p.key,
            value: p.value,
            version: { number: existingVersion + 1 },
          }));
      } else {
        // Create new property
        return ok(await confluenceRequest(accessToken, instanceUrl,
          `/content/${p.page_id}/property`, "POST", {
            key: p.key,
            value: p.value,
          }));
      }
    } catch (e) { return err(e); }
  });

  // ── User search tool ───────────────────────────────────────────────────────

  server.registerTool("confluence_search_users", {
    title: "Search Confluence Users",
    description: [
      "Search Confluence DC users by username, display name, or email prefix.",
      "Returns username, display name, email, and user key for each match.",
      "Useful for finding usernames to use in restrictions, mentions, and reports.",
    ].join(" "),
    inputSchema: SearchUsersInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const raw = await confluenceRequest(accessToken, instanceUrl,
        `/user/search?type=user&username=${encodeURIComponent(p.query)}&limit=${p.limit}`) as Array<{
          type?: string;
          username?: string;
          userKey?: string;
          displayName?: string;
          email?: string;
        }>;
      const users = (Array.isArray(raw) ? raw : []).map((u) => ({
        username:     u.username,
        display_name: u.displayName,
        email:        u.email,
        user_key:     u.userKey,
      }));
      return ok({ total: users.length, users });
    } catch (e) { return err(e); }
  });

  // ── Space permissions tool ─────────────────────────────────────────────────

  server.registerTool("confluence_get_space_permissions", {
    title: "Get Space Permissions",
    description: [
      "Get the permission grants for a Confluence space.",
      "Returns which users and groups have which operations allowed (view, page-edit, etc.).",
      "An empty result for a space means it uses default/global permissions.",
    ].join(" "),
    inputSchema: GetSpacePermissionsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const raw = await confluenceRequest(accessToken, instanceUrl,
        `/space/${p.space_key}/permission`) as {
          permissions?: Array<{
            operation?: { operation?: string; targetType?: string };
            anonymousAccess?: boolean;
            unlicensedAccess?: boolean;
            subjects?: {
              user?: { results?: Array<{ username?: string; displayName?: string }> };
              group?: { results?: Array<{ name?: string }> };
            };
          }>;
        };
      const perms = (raw.permissions ?? []).map((perm) => ({
        operation:  perm.operation?.operation,
        target:     perm.operation?.targetType,
        users:      (perm.subjects?.user?.results ?? []).map((u) => u.username ?? u.displayName),
        groups:     (perm.subjects?.group?.results ?? []).map((g) => g.name),
        anonymous:  perm.anonymousAccess,
        unlicensed: perm.unlicensedAccess,
      }));
      return ok({ space_key: p.space_key, permission_count: perms.length, permissions: perms });
    } catch (e) { return err(e); }
  });

}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}
function err(e: unknown) {
  return { isError: true, content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
}
