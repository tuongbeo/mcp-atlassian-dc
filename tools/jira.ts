/**
 * Jira Data Center MCP Tools (29 tools).
 * Phase 2 adds (+4): jira_add_content, jira_list_issue_files, jira_delete_file, jira_replace_file
 * Phase 3 adds (+8): jira_list_versions, jira_create_version, jira_update_version, jira_delete_version,
 *                    jira_list_components, jira_create_component, jira_update_component, jira_delete_component
 * Phase 4 adds (+2): jira_list_link_types, jira_issue_link
 *   NOTE: issuelinks is read-only in fields payload — must use POST /rest/api/2/issueLink endpoint.
 *   To read existing links on an issue: jira_get_issue(fields="issuelinks").
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jiraRequest, atlassianMultipartRequest, atlassianGenericRequest } from "../shared/atlassian";
import { MAX_UPLOAD_BYTES } from "../shared/types";
import { JIRA_DESCRIPTION_SUFFIX } from "../shared/mcp-resources";

type GetCreds = () => Promise<{ accessToken: string; instanceUrl: string }>;

const SearchInput = z.object({
  jql: z.string(),
  max_results: z.number().int().min(1).max(50).default(20),
  fields: z.string().default("summary,status,assignee,priority,issuetype,created,updated,description"),
  include_changelog: z.boolean().default(false).optional(),
});
const GetIssueInput = z.object({
  issue_key: z.string().describe("E.g. PROJ-123"),
  expand: z.string().default("renderedFields,names,changelog"),
});
const CreateIssueInput = z.object({
  project_key: z.string(), summary: z.string(),
  issue_type: z.string().default("Task"), description: z.string().optional(),
  priority: z.string().default("Medium"), assignee_name: z.string().optional(),
  labels: z.array(z.string()).optional(), parent_key: z.string().optional(),
  custom_fields: z.record(z.unknown()).optional(),
});
const UpdateIssueInput = z.object({
  issue_key: z.string(), summary: z.string().optional(), description: z.string().optional(),
  priority: z.string().optional(), assignee_name: z.string().optional().describe("Empty string to unassign"),
  labels: z.array(z.string()).optional(), custom_fields: z.record(z.unknown()).optional(),
});
const CommentInput = z.object({
  issue_key: z.string(), comment: z.string().describe("Plain text or wiki markup"),
});
const ProjectsInput = z.object({
  max_results: z.number().int().min(1).max(100).default(50), query: z.string().optional(),
});
const UsersInput = z.object({
  query: z.string(), max_results: z.number().int().min(1).max(50).default(10),
});
const SprintIssuesInput = z.object({
  sprint_id: z.number().int(),
  max_results: z.number().int().min(1).max(50).default(30),
  fields: z.string().default("summary,status,assignee,priority,issuetype,story_points,timetracking"),
});
const EpicIssuesInput = z.object({
  epic_key: z.string(),
  max_results: z.number().int().min(1).max(50).default(50),
  fields: z.string().default("summary,status,assignee,priority,story_points,timetracking"),
});
const JiraTransitionInput = z.object({
  issue_key: z.string().describe("Issue key, e.g. KEY-123"),
  transition_id: z.string().optional().describe("Transition ID from listing. If omitted, returns list of available transitions."),
  comment: z.string().optional().describe("Optional comment when performing transition"),
});
const JiraListSprintsInput = z.object({
  project_key: z.string().optional(), board_id: z.number().int().optional(),
  state: z.enum(["active","future","closed"]).default("active").optional(),
  max_results: z.number().int().min(1).max(50).default(10).optional(),
});
const JiraSprintAnalyticsInput = z.object({
  board_id: z.string(), sprint_id: z.string().optional(),
  type: z.enum(["report","velocity","both"]).default("report"),
});
const BulkIssueItem = z.object({
  project_key: z.string(), summary: z.string(),
  issue_type: z.string().default("Story").optional(),
  description: z.string().optional(), assignee_name: z.string().optional(),
  priority: z.string().default("Medium").optional(), parent_key: z.string().optional(),
  labels: z.array(z.string()).optional(), custom_fields: z.record(z.unknown()).optional(),
});
const JiraBulkCreateInput = z.object({ issues: z.array(BulkIssueItem).min(1).max(50) });
const JiraGetBacklogInput = z.object({
  project_key: z.string(),
  max_results: z.number().int().min(1).max(50).default(30).optional(),
  fields: z.string().default("summary,status,assignee,priority,issuetype,story_points").optional(),
});
const JiraSprintWorklogsInput = z.object({
  sprint_id: z.number().int(),
  max_issues: z.number().int().min(1).max(50).default(50).optional(),
});
const JiraAddContentInput = z.object({
  issue_key: z.string().describe("Jira issue key, e.g. TRACE-123"),
  filename: z.string().describe(
    "Filename with extension:\n" +
    "• Text files (.md .txt .csv .json .xml .mmd .drawio .ts .py etc.) + content → text attachment\n" +
    "• Binary files (.png .jpg .pdf .xlsx .docx .zip etc.) → proxy upload URL"
  ),
  content: z.string().optional().describe("Text content. Omit for binary → returns proxy URL."),
  comment: z.string().optional(),
});
const JiraListFilesInput = z.object({ issue_key: z.string() });
const JiraDeleteFileInput = z.object({
  attachment_id: z.string().describe("Numeric attachment ID (from jira_list_issue_files)"),
});
const JiraReplaceFileInput = z.object({
  issue_key: z.string(), filename: z.string(),
  content: z.string().optional().describe("New text content. Omit binary → proxy URL for PUT /upload/:issueKey/:filename."),
  comment: z.string().optional(),
});

// ── Phase 3: Version & Component schemas ─────────────────────────────────────

const JiraListVersionsInput = z.object({
  project_key: z.string().describe("Jira project key, e.g. TRACE"),
});
const JiraCreateVersionInput = z.object({
  project_key: z.string(),
  name: z.string().describe("Version name, e.g. v1.2.0"),
  description: z.string().optional(),
  release_date: z.string().optional().describe("ISO date yyyy-MM-dd"),
  start_date: z.string().optional().describe("ISO date yyyy-MM-dd"),
});
const JiraUpdateVersionInput = z.object({
  version_id: z.string().describe("Numeric version ID (from jira_list_versions)"),
  name: z.string().optional(),
  description: z.string().optional(),
  release_date: z.string().optional().describe("ISO date yyyy-MM-dd, empty string to clear"),
  start_date: z.string().optional().describe("ISO date yyyy-MM-dd, empty string to clear"),
  released: z.boolean().optional().describe("Mark version as released"),
  archived: z.boolean().optional().describe("Archive/unarchive version"),
});
const JiraDeleteVersionInput = z.object({
  version_id: z.string().describe("Numeric version ID (from jira_list_versions)"),
  move_fix_issues_to: z.string().optional().describe("Version ID to move fixVersion issues to (omit to clear)"),
  move_affected_issues_to: z.string().optional().describe("Version ID to move affectedVersion issues to (omit to clear)"),
});

const JiraListComponentsInput = z.object({
  project_key: z.string().describe("Jira project key, e.g. TRACE"),
});
const JiraCreateComponentInput = z.object({
  project_key: z.string(),
  name: z.string(),
  description: z.string().optional(),
  lead_username: z.string().optional().describe("Username of component lead"),
  assignee_type: z.enum(["PROJECT_DEFAULT","COMPONENT_LEAD","PROJECT_LEAD","UNASSIGNED"]).optional()
    .default("PROJECT_DEFAULT").describe("Default assignee strategy for issues in this component"),
});
const JiraUpdateComponentInput = z.object({
  component_id: z.string().describe("Numeric component ID (from jira_list_components)"),
  name: z.string().optional(),
  description: z.string().optional(),
  lead_username: z.string().optional(),
  assignee_type: z.enum(["PROJECT_DEFAULT","COMPONENT_LEAD","PROJECT_LEAD","UNASSIGNED"]).optional(),
});
const JiraDeleteComponentInput = z.object({
  component_id: z.string().describe("Numeric component ID (from jira_list_components)"),
  move_issues_to: z.string().optional().describe("Component ID to reassign issues to (omit to leave unassigned)"),
});

// ── Phase 4: Issue link schemas ───────────────────────────────────────────────
// issuelinks is a READ-ONLY field in the issue fields payload.
// Creating/deleting links MUST go through POST/DELETE /rest/api/2/issueLink.
// Reading links: jira_get_issue with fields="issuelinks" — no extra tool needed.

// ── Generic REST proxy schema ─────────────────────────────────────────────────

const JiraRestInput = z.object({
  method: z.enum(["GET", "POST", "PUT", "DELETE"]).describe("HTTP method"),
  path: z.string().describe(
    "Absolute path from the Jira instance root. Must start with /rest/ or /plugins/.\n" +
    "Examples:\n" +
    "  /rest/agile/1.0/board\n" +
    "  /rest/api/2/project/{key}/versions\n" +
    "  /rest/greenhopper/1.0/rapidview\n" +
    "  /rest/api/2/customFields\n" +
    "Do NOT include the instance URL — it is injected automatically."
  ),
  body: z.string().optional().describe(
    "Request body as a string. For JSON: pass JSON.stringify'd object. " +
    "For form-encoded: pass 'key1=val1&key2=val2'. Max 100 KB."
  ),
  content_type: z.enum(["json", "form"]).default("json").optional().describe(
    "'json' (default) → Content-Type: application/json. " +
    "'form' → Content-Type: application/x-www-form-urlencoded."
  ),
  query: z.record(z.string()).optional().describe(
    "Query parameters to append to the URL. E.g. {maxResults: '50', startAt: '0'}"
  ),
});

const JiraIssueLinkInput = z.object({
  action: z.enum(["add", "remove"]).describe(
    '"add" → POST /issueLink (requires type_name + both issue keys). ' +
    '"remove" → DELETE /issueLink/{id} (requires link_id from jira_get_issue fields=issuelinks).'
  ),
  // "add" fields
  type_name: z.string().optional().describe('Link type name, e.g. "Blocks", "Clones", "Relates" — get full list from jira_list_link_types'),
  inward_issue_key: z.string().optional().describe('Issue that is the inward side of the link, e.g. "TRACE-10 is blocked by TRACE-20" → inward = TRACE-10'),
  outward_issue_key: z.string().optional().describe('Issue that is the outward side of the link, e.g. "TRACE-20 blocks TRACE-10" → outward = TRACE-20'),
  comment: z.string().optional().describe("Optional comment body (wiki markup) added when creating the link"),
  // "remove" field
  link_id: z.string().optional().describe('Numeric link ID — visible in jira_get_issue response under fields.issuelinks[].id'),
});

export function registerJiraTools(server: McpServer, getCreds: GetCreds, workerBaseUrl = ""): void {

  server.registerTool("jira_search", {
    title: "Search Jira Issues",
    description: "Search Jira issues using JQL. Returns key, summary, status, assignee, priority, custom fields. Set include_changelog=true for full transition history.",
    inputSchema: SearchInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const expand = p.include_changelog ? "renderedFields,names,changelog" : "renderedFields,names";
      return ok(await jiraRequest(accessToken, instanceUrl,
        `/search?jql=${encodeURIComponent(p.jql)}&maxResults=${p.max_results}&fields=${p.fields}&expand=${expand}`));
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_get_issue", {
    title: "Get Jira Issue",
    description: "Get full details of a Jira issue including changelog and custom fields.",
    inputSchema: GetIssueInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      return ok(await jiraRequest(accessToken, instanceUrl, `/issue/${p.issue_key}?expand=${p.expand}`));
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_create_issue", {
    title: "Create Jira Issue",
    description: "Create a Task, Bug, Story, Epic, or Sub-task." + JIRA_DESCRIPTION_SUFFIX,
    inputSchema: CreateIssueInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const fields: Record<string, unknown> = {
        project: { key: p.project_key }, summary: p.summary,
        issuetype: { name: p.issue_type }, priority: { name: p.priority },
      };
      if (p.description) fields.description = p.description;
      if (p.assignee_name) fields.assignee = { name: p.assignee_name };
      if (p.labels?.length) fields.labels = p.labels;
      if (p.parent_key) fields.parent = { key: p.parent_key };
      if (p.custom_fields) Object.assign(fields, p.custom_fields);
      return ok(await jiraRequest(accessToken, instanceUrl, "/issue", "POST", { fields }));
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_update_issue", {
    title: "Update Jira Issue",
    description: "Update issue fields. Only provided fields are changed." + JIRA_DESCRIPTION_SUFFIX,
    inputSchema: UpdateIssueInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const fields: Record<string, unknown> = {};
      if (p.summary !== undefined) fields.summary = p.summary;
      if (p.description !== undefined) fields.description = p.description;
      if (p.priority) fields.priority = { name: p.priority };
      if (p.assignee_name !== undefined) fields.assignee = p.assignee_name ? { name: p.assignee_name } : null;
      if (p.labels) fields.labels = p.labels;
      if (p.custom_fields) Object.assign(fields, p.custom_fields);
      await jiraRequest(accessToken, instanceUrl, `/issue/${p.issue_key}`, "PUT", { fields });
      return ok(`Issue ${p.issue_key} updated.`);
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_transition", {
    title: "List or Execute Issue Transition",
    description: "List available transitions for an issue, or execute a specific transition. Call without transition_id to get the list, then call again with transition_id to execute.",
    inputSchema: JiraTransitionInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      if (!p.transition_id) {
        const data = await jiraRequest(accessToken, instanceUrl,
          `/issue/${p.issue_key}/transitions`) as { transitions: Array<{ id: string; name: string; to: { name: string } }> };
        return ok((data.transitions ?? []).map(t => ({ id: t.id, name: t.name, to: t.to?.name })));
      }
      const body: Record<string, unknown> = { transition: { id: p.transition_id } };
      if (p.comment) body.update = { comment: [{ add: { body: p.comment } }] };
      await jiraRequest(accessToken, instanceUrl, `/issue/${p.issue_key}/transitions`, "POST", body);
      return ok(`Issue ${p.issue_key} transitioned.`);
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_add_comment", {
    title: "Add Jira Comment",
    description: "Add a comment to a Jira issue (plain text or wiki markup).",
    inputSchema: CommentInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      return ok(await jiraRequest(accessToken, instanceUrl, `/issue/${p.issue_key}/comment`, "POST", { body: p.comment }));
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_get_projects", {
    title: "List Jira Projects",
    description: "List all accessible Jira projects.",
    inputSchema: ProjectsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      let path = `/project?maxResults=${p.max_results}&expand=description`;
      if (p.query) path += `&query=${encodeURIComponent(p.query)}`;
      return ok(await jiraRequest(accessToken, instanceUrl, path));
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_search_users", {
    title: "Search Jira Users",
    description: "Search Jira DC users by name or email.",
    inputSchema: UsersInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      return ok(await jiraRequest(accessToken, instanceUrl,
        `/user/search?username=${encodeURIComponent(p.query)}&maxResults=${p.max_results}`));
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_list_sprints", {
    title: "List Sprints",
    description: "List sprints for a project or board. Provide project_key OR board_id.",
    inputSchema: JiraListSprintsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const base = instanceUrl.replace(/\/$/, "");
      let boardId = p.board_id;
      if (!boardId) {
        if (!p.project_key) return err(new Error("Provide project_key or board_id"));
        const boardRes = await fetch(
          `${base}/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(p.project_key)}&type=scrum`,
          { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
        if (!boardRes.ok) throw new Error(`Boards: ${boardRes.status}`);
        const boardData = await boardRes.json() as { values: Array<{ id: number }> };
        if (!boardData.values?.length) return err(new Error(`No Scrum board for ${p.project_key}`));
        boardId = boardData.values[0].id;
      }
      const sprintRes = await fetch(
        `${base}/rest/agile/1.0/board/${boardId}/sprint?state=${p.state ?? "active"}&maxResults=${p.max_results ?? 10}`,
        { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
      if (!sprintRes.ok) throw new Error(`Sprints: ${sprintRes.status}`);
      const sprintData = await sprintRes.json() as { values: unknown[] };
      return ok({ board_id: boardId, sprints: sprintData.values });
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_get_sprint_issues", {
    title: "Get Sprint Issues",
    description: "Get all issues in a specific sprint including story points and time tracking.",
    inputSchema: SprintIssuesInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const base = instanceUrl.replace(/\/$/, "");
      const res = await fetch(
        `${base}/rest/agile/1.0/sprint/${p.sprint_id}/issue?maxResults=${p.max_results}&fields=${p.fields}`,
        { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
      if (!res.ok) throw new Error(`Sprint issues: ${res.status}`);
      return ok(await res.json());
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_get_epic_issues", {
    title: "Get Epic Issues",
    description: "Get all child issues of an Epic.",
    inputSchema: EpicIssuesInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const queries = [`parent = "${p.epic_key}"`, `"Epic Link" = "${p.epic_key}"`];
      for (const jql of queries) {
        try {
          const result = await jiraRequest(accessToken, instanceUrl,
            `/search?jql=${encodeURIComponent(jql)}&maxResults=${p.max_results}&fields=${p.fields}`) as { issues?: unknown[] };
          if (result && Array.isArray(result.issues) && result.issues.length > 0) return ok(result);
        } catch { /* try next */ }
      }
      return ok(await jiraRequest(accessToken, instanceUrl,
        `/search?jql=${encodeURIComponent(queries[0])}&maxResults=${p.max_results}&fields=${p.fields}`));
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_sprint_analytics", {
    title: "Sprint Analytics",
    description: "Sprint analytics: report (completed/incomplete issues) or velocity (story points per sprint).",
    inputSchema: JiraSprintAnalyticsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const base = instanceUrl.replace(/\/$/, "");
      const result: Record<string, unknown> = {};
      if (p.type === "report" || p.type === "both") {
        if (!p.sprint_id) return err(new Error("sprint_id required for type=report"));
        const r = await fetch(`${base}/rest/greenhopper/1.0/rapid/charts/sprintreport?rapidViewId=${p.board_id}&sprintId=${p.sprint_id}`,
          { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
        if (!r.ok) throw new Error(`Sprint report: ${r.status}`);
        const data = await r.json() as { contents?: { completedIssues?: unknown[]; incompletedIssues?: unknown[]; puntedIssues?: unknown[] }; sprint?: unknown };
        result.report = { sprint: data.sprint, completed_issues: data.contents?.completedIssues ?? [],
          incompleted_issues: data.contents?.incompletedIssues ?? [], punted_issues: data.contents?.puntedIssues ?? [] };
      }
      if (p.type === "velocity" || p.type === "both") {
        const r = await fetch(`${base}/rest/greenhopper/1.0/rapid/charts/velocity?rapidViewId=${p.board_id}`,
          { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
        if (!r.ok) throw new Error(`Velocity: ${r.status}`);
        const data = await r.json() as {
          velocityStatEntries?: Record<string, { estimated?: { value?: number }; completed?: { value?: number } }>;
          sprints?: Array<{ id: number; name?: string }>;
        };
        const sprintMap: Record<string, string> = {};
        for (const s of (data.sprints ?? [])) sprintMap[String(s.id)] = s.name ?? String(s.id);
        const entries = Object.entries(data.velocityStatEntries ?? {}).map(([id, v]) => ({
          sprint_id: id, sprint_name: sprintMap[id] ?? id,
          committed_sp: v.estimated?.value ?? 0, completed_sp: v.completed?.value ?? 0,
        }));
        const recent = entries.slice(-3).map(e => e.completed_sp);
        const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        result.velocity = { sprints: entries, rolling_3sprint_avg: Math.round(avg(recent) * 10) / 10 };
      }
      return ok(p.type === "both" ? result : (result.report ?? result.velocity));
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_bulk_create_issues", {
    title: "Bulk Create Jira Issues",
    description: "Create multiple Jira issues in a single call. Returns array of created issue keys." + JIRA_DESCRIPTION_SUFFIX,
    inputSchema: JiraBulkCreateInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const issueUpdates = p.issues.map(issue => {
        const fields: Record<string, unknown> = {
          project: { key: issue.project_key }, summary: issue.summary,
          issuetype: { name: issue.issue_type ?? "Story" }, priority: { name: issue.priority ?? "Medium" },
        };
        if (issue.description) fields.description = issue.description;
        if (issue.assignee_name) fields.assignee = { name: issue.assignee_name };
        if (issue.labels?.length) fields.labels = issue.labels;
        if (issue.parent_key) fields.parent = { key: issue.parent_key };
        if (issue.custom_fields) Object.assign(fields, issue.custom_fields);
        return { fields };
      });
      const data = await jiraRequest(accessToken, instanceUrl,
        "/issue/bulk", "POST", { issueUpdates }) as { issues: Array<{ key: string }>; errors: unknown[] };
      return ok({ created: (data.issues ?? []).map(i => i.key), errors: data.errors ?? [] });
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_get_backlog", {
    title: "Get Project Backlog",
    description: "Get issues in the backlog (not assigned to any sprint) for a project.",
    inputSchema: JiraGetBacklogInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const jql = `project="${p.project_key}" AND sprint is EMPTY AND resolution is EMPTY ORDER BY priority DESC`;
      const data = await jiraRequest(accessToken, instanceUrl,
        `/search?jql=${encodeURIComponent(jql)}&maxResults=${p.max_results ?? 30}&fields=${p.fields}`) as { total: number; issues: unknown[] };
      return ok({ total: data.total, issues: data.issues });
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_get_sprint_worklogs", {
    title: "Get Sprint Worklogs",
    description: "Aggregate all work logs for a sprint, grouped by user.",
    inputSchema: JiraSprintWorklogsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const base = instanceUrl.replace(/\/$/, "");
      const issueRes = await fetch(
        `${base}/rest/agile/1.0/sprint/${p.sprint_id}/issue?fields=worklog,summary&maxResults=${p.max_issues ?? 50}`,
        { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
      if (!issueRes.ok) throw new Error(`Sprint issues: ${issueRes.status}`);
      const issueData = await issueRes.json() as {
        issues: Array<{ key: string; fields: { summary: string; worklog: { worklogs: Array<{ author: { name: string; displayName: string }; timeSpentSeconds: number; started: string }> } } }>;
      };
      const userMap: Record<string, { displayName: string; total_seconds: number; entries: unknown[] }> = {};
      for (const issue of issueData.issues ?? []) {
        for (const wl of (issue.fields.worklog?.worklogs ?? [])) {
          const u = wl.author.name;
          if (!userMap[u]) userMap[u] = { displayName: wl.author.displayName, total_seconds: 0, entries: [] };
          userMap[u].total_seconds += wl.timeSpentSeconds;
          userMap[u].entries.push({ issue_key: issue.key, summary: issue.fields.summary, started: wl.started, hours: Math.round(wl.timeSpentSeconds / 3600 * 10) / 10 });
        }
      }
      return ok({ sprint_id: p.sprint_id, users: Object.entries(userMap).map(([username, d]) => ({ username, displayName: d.displayName, total_hours: Math.round(d.total_seconds / 3600 * 10) / 10, entries: d.entries })).sort((a, b) => b.total_hours - a.total_hours) });
    } catch (e) { return err(e); }
  });

  // ── Phase 2: File content tools ───────────────────────────────────────────────

  server.registerTool("jira_add_content", {
    title: "Add Content to Jira Issue",
    description: "Attach content to a Jira issue. Text files + content → attachment. Binary files → proxy upload URL.",
    inputSchema: JiraAddContentInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const ext = (p.filename.split(".").pop() ?? "").toLowerCase();
      const hasContent = typeof p.content === "string" && p.content.length > 0;
      if (hasContent) {
        const contentBytes = new TextEncoder().encode(p.content).byteLength;
        if (contentBytes > MAX_UPLOAD_BYTES) return err(`Content ${(contentBytes / 1024 / 1024).toFixed(1)} MB exceeds 20 MB limit.`);
        const fd = new FormData();
        fd.append("file", new Blob([p.content!], { type: jiraExtToMime(ext) }), p.filename);
        const uploadUrl = `${instanceUrl.replace(/\/$/, "")}/rest/api/2/issue/${p.issue_key}/attachments`;
        const result = await atlassianMultipartRequest(accessToken, uploadUrl, fd) as Array<{ id: string }>;
        return ok({ action: "attachment_created", issue_key: p.issue_key, filename: p.filename, attachment_id: result[0]?.id, size_bytes: contentBytes });
      }
      const endpoint = `${workerBaseUrl}/upload/${p.issue_key}`;
      return ok({ action: "proxy_upload_required", issue_key: p.issue_key, filename: p.filename,
        upload_endpoint: endpoint, curl_example: `curl -X POST \\\n  -H "Authorization: Bearer YOUR_BEARER_TOKEN" \\\n  -F "file=@${p.filename}" \\\n  "${endpoint}"` });
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_list_issue_files", {
    title: "List Files on Jira Issue",
    description: "List all file attachments on a Jira issue: filename, size, MIME type, author, download URL.",
    inputSchema: JiraListFilesInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const issue = await jiraRequest(accessToken, instanceUrl, `/issue/${p.issue_key}?fields=attachment`) as {
        fields?: { attachment?: Array<{ id: string; filename: string; size: number; mimeType: string; author?: { displayName?: string; name?: string }; created?: string; content?: string; thumbnail?: string }> };
      };
      const files = (issue.fields?.attachment ?? []).map(a => ({
        attachment_id: a.id, filename: a.filename, size_bytes: a.size, mime_type: a.mimeType,
        author: a.author?.displayName ?? a.author?.name ?? "Unknown",
        created: a.created, download_url: a.content, thumbnail_url: a.thumbnail,
      }));
      return ok({ issue_key: p.issue_key, total: files.length, files });
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_delete_file", {
    title: "Delete File from Jira Issue",
    description: "Delete an attachment by ID. Cannot be undone. Get attachment_id from jira_list_issue_files.",
    inputSchema: JiraDeleteFileInput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      await jiraRequest(accessToken, instanceUrl, `/attachment/${p.attachment_id}`, "DELETE");
      return ok({ deleted: true, attachment_id: p.attachment_id });
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_replace_file", {
    title: "Replace File on Jira Issue",
    description: "Atomically replace a text attachment (find by filename → delete → upload). For binary files (no content), returns proxy URL for PUT /upload/:issueKey/:filename.",
    inputSchema: JiraReplaceFileInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const ext = (p.filename.split(".").pop() ?? "").toLowerCase();
      const hasContent = typeof p.content === "string" && p.content.length > 0;
      const base = instanceUrl.replace(/\/$/, "");
      if (!hasContent) {
        const endpoint = `${workerBaseUrl}/upload/${p.issue_key}/${encodeURIComponent(p.filename)}`;
        return ok({ action: "proxy_upload_required", issue_key: p.issue_key, filename: p.filename,
          upload_endpoint: endpoint, curl_example: `curl -X PUT \\\n  -H "Authorization: Bearer YOUR_BEARER_TOKEN" \\\n  -F "file=@${p.filename}" \\\n  "${endpoint}"`,
          note: "Worker deletes existing attachment (if any) then uploads new file." });
      }
      const contentBytes = new TextEncoder().encode(p.content).byteLength;
      if (contentBytes > MAX_UPLOAD_BYTES) return err(`Content ${(contentBytes / 1024 / 1024).toFixed(1)} MB exceeds 20 MB.`);
      const issue = await jiraRequest(accessToken, instanceUrl, `/issue/${p.issue_key}?fields=attachment`) as {
        fields?: { attachment?: Array<{ id: string; filename: string }> };
      };
      const existing = issue.fields?.attachment?.find(a => a.filename === p.filename);
      let deletedId: string | null = null;
      if (existing) {
        await jiraRequest(accessToken, instanceUrl, `/attachment/${existing.id}`, "DELETE");
        deletedId = existing.id;
      }
      const fd = new FormData();
      fd.append("file", new Blob([p.content!], { type: jiraExtToMime(ext) }), p.filename);
      const result = await atlassianMultipartRequest(accessToken, `${base}/rest/api/2/issue/${p.issue_key}/attachments`, fd) as Array<{ id: string }>;
      return ok({ action: "attachment_replaced", issue_key: p.issue_key, filename: p.filename, deleted_id: deletedId, created_id: result[0]?.id, size_bytes: contentBytes });
    } catch (e) { return err(e); }
  });
  // ── Phase 3: Version management ──────────────────────────────────────────────

  server.registerTool("jira_list_versions", {
    title: "List Project Versions",
    description: "List all fix versions / releases for a Jira project. Returns id, name, description, releaseDate, released, archived status.",
    inputSchema: JiraListVersionsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const versions = await jiraRequest(accessToken, instanceUrl,
        `/project/${p.project_key}/versions`) as Array<{ id: string; name: string; description?: string; releaseDate?: string; startDate?: string; released: boolean; archived: boolean }>;
      return ok({ project_key: p.project_key, total: versions.length, versions: versions.map(v => ({
        id: v.id, name: v.name, description: v.description,
        release_date: v.releaseDate, start_date: v.startDate,
        released: v.released, archived: v.archived,
      })) });
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_create_version", {
    title: "Create Project Version",
    description: "Create a new fix version / release for a Jira project.",
    inputSchema: JiraCreateVersionInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const body: Record<string, unknown> = { project: p.project_key, name: p.name };
      if (p.description) body.description = p.description;
      if (p.release_date) body.releaseDate = p.release_date;
      if (p.start_date) body.startDate = p.start_date;
      const result = await jiraRequest(accessToken, instanceUrl, "/version", "POST", body) as { id: string; name: string };
      return ok({ created: true, version_id: result.id, name: result.name });
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_update_version", {
    title: "Update Project Version",
    description: "Update a version's name, description, dates, released or archived status. Only provided fields are changed.",
    inputSchema: JiraUpdateVersionInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const body: Record<string, unknown> = {};
      if (p.name !== undefined) body.name = p.name;
      if (p.description !== undefined) body.description = p.description;
      if (p.release_date !== undefined) body.releaseDate = p.release_date === "" ? "" : p.release_date;
      if (p.start_date !== undefined) body.startDate = p.start_date === "" ? "" : p.start_date;
      if (p.released !== undefined) body.released = p.released;
      if (p.archived !== undefined) body.archived = p.archived;
      await jiraRequest(accessToken, instanceUrl, `/version/${p.version_id}`, "PUT", body);
      return ok(`Version ${p.version_id} updated.`);
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_delete_version", {
    title: "Delete Project Version",
    description: "Delete a version. Optionally move fixVersion / affectedVersion references to another version.",
    inputSchema: JiraDeleteVersionInput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      let path = `/version/${p.version_id}`;
      const qs: string[] = [];
      if (p.move_fix_issues_to) qs.push(`moveFixIssuesTo=${encodeURIComponent(p.move_fix_issues_to)}`);
      if (p.move_affected_issues_to) qs.push(`moveAffectedIssuesTo=${encodeURIComponent(p.move_affected_issues_to)}`);
      if (qs.length) path += `?${qs.join("&")}`;
      await jiraRequest(accessToken, instanceUrl, path, "DELETE");
      return ok({ deleted: true, version_id: p.version_id });
    } catch (e) { return err(e); }
  });

  // ── Phase 3: Component management ────────────────────────────────────────────

  server.registerTool("jira_list_components", {
    title: "List Project Components",
    description: "List all components for a Jira project. Returns id, name, description, lead, assigneeType.",
    inputSchema: JiraListComponentsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const components = await jiraRequest(accessToken, instanceUrl,
        `/project/${p.project_key}/components`) as Array<{ id: string; name: string; description?: string; lead?: { name: string; displayName: string }; assigneeType?: string; realAssigneeType?: string }>;
      return ok({ project_key: p.project_key, total: components.length, components: components.map(c => ({
        id: c.id, name: c.name, description: c.description,
        lead: c.lead ? { username: c.lead.name, display_name: c.lead.displayName } : null,
        assignee_type: c.assigneeType, real_assignee_type: c.realAssigneeType,
      })) });
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_create_component", {
    title: "Create Project Component",
    description: "Create a new component in a Jira project with optional lead and default assignee strategy.",
    inputSchema: JiraCreateComponentInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const body: Record<string, unknown> = {
        project: p.project_key, name: p.name,
        assigneeType: p.assignee_type ?? "PROJECT_DEFAULT",
      };
      if (p.description) body.description = p.description;
      if (p.lead_username) body.lead = { name: p.lead_username };
      const result = await jiraRequest(accessToken, instanceUrl, "/component", "POST", body) as { id: string; name: string };
      return ok({ created: true, component_id: result.id, name: result.name });
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_update_component", {
    title: "Update Project Component",
    description: "Update a component's name, description, lead, or default assignee strategy. Only provided fields are changed.",
    inputSchema: JiraUpdateComponentInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const body: Record<string, unknown> = {};
      if (p.name !== undefined) body.name = p.name;
      if (p.description !== undefined) body.description = p.description;
      if (p.lead_username !== undefined) body.lead = { name: p.lead_username ?? "" };
      if (p.assignee_type !== undefined) body.assigneeType = p.assignee_type;
      await jiraRequest(accessToken, instanceUrl, `/component/${p.component_id}`, "PUT", body);
      return ok(`Component ${p.component_id} updated.`);
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_delete_component", {
    title: "Delete Project Component",
    description: "Delete a component. Optionally move issues assigned to it to another component.",
    inputSchema: JiraDeleteComponentInput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      let path = `/component/${p.component_id}`;
      if (p.move_issues_to) path += `?moveIssuesTo=${encodeURIComponent(p.move_issues_to)}`;
      await jiraRequest(accessToken, instanceUrl, path, "DELETE");
      return ok({ deleted: true, component_id: p.component_id });
    } catch (e) { return err(e); }
  });

  // ── Phase 4: Issue link management ───────────────────────────────────────────
  // IMPORTANT: issuelinks cannot be set via fields payload in create/update issue.
  // Use jira_get_issue(fields="issuelinks") to read existing links on an issue.

  server.registerTool("jira_list_link_types", {
    title: "List Issue Link Types",
    description:
      "List all available issue link types (e.g. Blocks, Clones, Relates To, Duplicate). " +
      "Returns id, name, inward label, outward label. Call this before jira_issue_link(action=add) " +
      "to get the correct type_name.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async () => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const data = await jiraRequest(accessToken, instanceUrl, "/issueLinkType") as {
        issueLinkTypes: Array<{ id: string; name: string; inward: string; outward: string; self: string }>;
      };
      return ok((data.issueLinkTypes ?? []).map(t => ({
        id: t.id, name: t.name, inward: t.inward, outward: t.outward,
      })));
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_issue_link", {
    title: "Add or Remove Issue Link",
    description:
      "Add or remove a directional link between two Jira issues via POST/DELETE /issueLink.\n" +
      "IMPORTANT: issuelinks CANNOT be set via fields payload in jira_create_issue / jira_update_issue.\n\n" +
      'action="add": Creates a link. Requires type_name (from jira_list_link_types), ' +
      "inward_issue_key, outward_issue_key. The direction matters — e.g. type=Blocks, " +
      'outward=TRACE-20 means "TRACE-20 blocks [inward issue]".\n\n' +
      'action="remove": Deletes a link by its link_id. Get link_id from ' +
      'jira_get_issue(issue_key, fields="issuelinks") → fields.issuelinks[].id.',
    inputSchema: JiraIssueLinkInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      if (p.action === "remove") {
        if (!p.link_id) return err('action="remove" requires link_id');
        await jiraRequest(accessToken, instanceUrl, `/issueLink/${p.link_id}`, "DELETE");
        return ok({ action: "removed", link_id: p.link_id });
      }
      // action === "add"
      if (!p.type_name) return err('action="add" requires type_name');
      if (!p.inward_issue_key) return err('action="add" requires inward_issue_key');
      if (!p.outward_issue_key) return err('action="add" requires outward_issue_key');
      const body: Record<string, unknown> = {
        type: { name: p.type_name },
        inwardIssue: { key: p.inward_issue_key },
        outwardIssue: { key: p.outward_issue_key },
      };
      if (p.comment) body.comment = { body: p.comment };
      await jiraRequest(accessToken, instanceUrl, "/issueLink", "POST", body);
      return ok({
        action: "added",
        type: p.type_name,
        inward: p.inward_issue_key,
        outward: p.outward_issue_key,
      });
    } catch (e) { return err(e); }
  });

  // ── Generic REST proxy ────────────────────────────────────────────────────

  server.tool("jira_rest",
    "Generic Jira REST proxy. Call any Jira REST endpoint not covered by a dedicated tool.\n" +
    "Credentials are injected automatically — do not pass Authorization headers.\n" +
    "path must start with /rest/ or /plugins/ (e.g. /rest/agile/1.0/board).\n" +
    "Returns {status, status_text, headers, body} — does NOT throw on HTTP errors.\n" +
    "Use cases: Agile/GreenHopper endpoints, plugin APIs, custom field discovery, admin APIs.",
    JiraRestInput.shape,
    async (p) => {
      try {
        const { accessToken, instanceUrl } = await getCreds();
        if (!p.path.startsWith("/rest/") && !p.path.startsWith("/plugins/")) {
          return err("path must start with /rest/ or /plugins/ — e.g. /rest/agile/1.0/board");
        }
        if (p.body && p.body.length > 100 * 1024) {
          return err("body exceeds 100 KB limit");
        }
        const result = await atlassianGenericRequest(
          accessToken, instanceUrl,
          p.path, p.method,
          p.body, p.content_type ?? "json",
          p.query
        );
        return ok(result);
      } catch (e) { return err(e); }
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function jiraExtToMime(ext: string): string {
  const map: Record<string, string> = {
    md: "text/markdown", txt: "text/plain", csv: "text/csv",
    json: "application/json", xml: "application/xml", html: "text/html",
    svg: "image/svg+xml", ts: "text/typescript", tsx: "text/typescript",
    js: "text/javascript", jsx: "text/javascript",
    py: "text/x-python", sh: "text/x-sh", bash: "text/x-sh", sql: "text/x-sql",
    css: "text/css", yaml: "application/x-yaml", yml: "application/x-yaml",
    tf: "text/plain", toml: "application/toml", conf: "text/plain",
    ini: "text/plain", log: "text/plain", env: "text/plain",
    mmd: "text/plain", mermaid: "text/plain", drawio: "application/xml",
  };
  return map[ext] ?? "application/octet-stream";
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}
function err(e: unknown) {
  return { isError: true, content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
}
