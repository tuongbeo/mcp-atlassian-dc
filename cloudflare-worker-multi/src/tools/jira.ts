/**
 * Jira Data Center MCP Tools (13 tools).
 * DC uses REST API v2 + Agile API v1.
 * Zod schemas at module scope — created once, not per request.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jiraRequest } from "../atlassian";

type GetCreds = () => Promise<{ accessToken: string; instanceUrl: string }>;

// ── Schemas ───────────────────────────────────────────────────────────────────

const SearchInput = z.object({
  jql: z.string().describe("JQL query. E.g. 'project=PROJ AND status=Open ORDER BY updated DESC'"),
  max_results: z.number().int().min(1).max(50).default(20),
  fields: z.string().default("summary,status,assignee,priority,issuetype,created,updated,description,customfield_10512,customfield_10515,customfield_10514,customfield_10516"),
});
const GetIssueInput = z.object({
  issue_key: z.string().describe("E.g. PROJ-123"),
  expand: z.string().default("renderedFields,names,changelog"),
});
const CreateIssueInput = z.object({
  project_key: z.string(),
  summary: z.string(),
  issue_type: z.string().default("Task").describe("Task, Bug, Story, Epic, Sub-task"),
  description: z.string().optional().describe("Plain text or wiki markup"),
  priority: z.string().default("Medium"),
  assignee_name: z.string().optional().describe("DC username (not accountId)"),
  labels: z.array(z.string()).optional(),
  parent_key: z.string().optional(),
  custom_fields: z.record(z.unknown()).optional().describe("{fieldId: value}"),
});
const UpdateIssueInput = z.object({
  issue_key: z.string(),
  summary: z.string().optional(),
  description: z.string().optional(),
  priority: z.string().optional(),
  assignee_name: z.string().optional().describe("Empty string to unassign"),
  labels: z.array(z.string()).optional(),
  custom_fields: z.record(z.unknown()).optional(),
});
const TransitionInput = z.object({
  issue_key: z.string(),
  transition_id: z.string().describe("ID from jira_get_transitions"),
  comment: z.string().optional(),
});
const CommentInput = z.object({
  issue_key: z.string(),
  comment: z.string().describe("Plain text or wiki markup"),
});
const ProjectsInput = z.object({
  max_results: z.number().int().min(1).max(100).default(50),
  query: z.string().optional(),
});
const UsersInput = z.object({
  query: z.string().describe("Name or email"),
  max_results: z.number().int().min(1).max(50).default(10),
});
const ProjectKeyInput = z.object({ project_key: z.string() });
const IssueKeyInput   = z.object({ issue_key: z.string() });
const BoardsInput = z.object({
  project_key: z.string().optional(),
  max_results: z.number().int().min(1).max(50).default(20),
});
const SprintsInput = z.object({
  board_id: z.number().int(),
  state: z.enum(["active", "future", "closed"]).optional(),
  max_results: z.number().int().min(1).max(50).default(10),
});
const SprintIssuesInput = z.object({
  sprint_id: z.number().int(),
  max_results: z.number().int().min(1).max(50).default(30),
  fields: z.string().default("summary,status,assignee,priority,issuetype"),
});

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerJiraTools(server: McpServer, getCreds: GetCreds): void {

  server.registerTool("jira_search", {
    title: "Search Jira Issues",
    description: "Search Jira issues using JQL. Returns key, summary, status, assignee, priority, custom fields.",
    inputSchema: SearchInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      return ok(await jiraRequest(accessToken, instanceUrl,
        `/search?jql=${encodeURIComponent(p.jql)}&maxResults=${p.max_results}&fields=${p.fields}`));
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
    description: "Create a Task, Bug, Story, Epic, or Sub-task. Returns new issue key.",
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
    description: "Update issue fields. Only provided fields are changed.",
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

  server.registerTool("jira_get_transitions", {
    title: "Get Issue Transitions",
    description: "Get available status transitions for a Jira issue.",
    inputSchema: IssueKeyInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      return ok(await jiraRequest(accessToken, instanceUrl, `/issue/${p.issue_key}/transitions`));
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_transition_issue", {
    title: "Transition Jira Issue",
    description: "Change issue status using transition ID from jira_get_transitions.",
    inputSchema: TransitionInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
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
    description: "List all accessible Jira projects. Optionally filter by name or key.",
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

  server.registerTool("jira_get_issue_types", {
    title: "Get Issue Types",
    description: "Get all issue types available in a Jira project.",
    inputSchema: ProjectKeyInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      return ok(await jiraRequest(accessToken, instanceUrl, `/project/${p.project_key}`));
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_get_agile_boards", {
    title: "Get Agile Boards",
    description: "List Scrum/Kanban boards. Optionally filter by project key.",
    inputSchema: BoardsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      let path = `/rest/agile/1.0/board?maxResults=${p.max_results}`;
      if (p.project_key) path += `&projectKeyOrId=${encodeURIComponent(p.project_key)}`;
      const res = await fetch(`${instanceUrl.replace(/\/$/, "")}${path}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Agile boards: ${res.status}`);
      return ok(await res.json());
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_get_sprints", {
    title: "Get Sprints",
    description: "List sprints for a board. Filter by state: active, future, closed.",
    inputSchema: SprintsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      let path = `/rest/agile/1.0/board/${p.board_id}/sprint?maxResults=${p.max_results}`;
      if (p.state) path += `&state=${p.state}`;
      const res = await fetch(`${instanceUrl.replace(/\/$/, "")}${path}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Sprints: ${res.status}`);
      return ok(await res.json());
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_get_sprint_issues", {
    title: "Get Sprint Issues",
    description: "Get all issues in a specific sprint.",
    inputSchema: SprintIssuesInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const path = `/rest/agile/1.0/sprint/${p.sprint_id}/issue?maxResults=${p.max_results}&fields=${p.fields}`;
      const res = await fetch(`${instanceUrl.replace(/\/$/, "")}${path}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Sprint issues: ${res.status}`);
      return ok(await res.json());
    } catch (e) { return err(e); }
  });
}

// ── Response helpers ──────────────────────────────────────────────────────────

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}
function err(e: unknown) {
  return { isError: true, content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
}
