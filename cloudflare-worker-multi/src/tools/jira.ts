/**
 * Jira Data Center MCP Tools (18 tools).
 * DC uses REST API v2 + Agile API v1 + GreenHopper API.
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
  board_type: z.enum(["scrum", "kanban"]).optional(),
  max_results: z.number().int().min(1).max(50).default(20),
});
const SprintsInput = z.object({
  board_id: z.number().int(),
  state: z.enum(["active", "future", "closed"]).optional().default("active"),
  max_results: z.number().int().min(1).max(50).default(10),
});
const SprintIssuesInput = z.object({
  sprint_id: z.number().int(),
  max_results: z.number().int().min(1).max(50).default(30),
  fields: z.string().default("summary,status,assignee,priority,issuetype,story_points,timetracking"),
});
const EpicIssuesInput = z.object({
  epic_key: z.string().describe("Epic issue key, e.g. PROJ-10"),
  max_results: z.number().int().min(1).max(50).default(50),
  fields: z.string().default("summary,status,assignee,priority,story_points,timetracking"),
});
const BoardIdInput = z.object({
  board_id: z.string().describe("Board (rapidView) ID"),
});
const SprintReportInput = z.object({
  board_id: z.string().describe("Board (rapidView) ID"),
  sprint_id: z.string().describe("Sprint ID"),
});
const DashboardsInput = z.object({
  max_results: z.number().int().min(1).max(50).default(20),
  filter: z.string().optional().describe("Filter string to narrow results"),
});
const DashboardChartInput = z.object({
  dashboard_id: z.string().describe("Jira dashboard ID"),
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

  // ── Agile tools ──────────────────────────────────────────────────────────────

  server.registerTool("jira_get_agile_boards", {
    title: "Get Agile Boards",
    description: "List Scrum/Kanban boards. Optionally filter by project key or board type.",
    inputSchema: BoardsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const base = instanceUrl.replace(/\/$/, "");
      let path = `/rest/agile/1.0/board?maxResults=${p.max_results}`;
      if (p.project_key) path += `&projectKeyOrId=${encodeURIComponent(p.project_key)}`;
      if (p.board_type) path += `&type=${p.board_type}`;
      const res = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Agile boards: ${res.status} ${await res.text()}`);
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
      const base = instanceUrl.replace(/\/$/, "");
      let path = `/rest/agile/1.0/board/${p.board_id}/sprint?maxResults=${p.max_results}`;
      if (p.state) path += `&state=${p.state}`;
      const res = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Sprints: ${res.status} ${await res.text()}`);
      return ok(await res.json());
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
      const path = `/rest/agile/1.0/sprint/${p.sprint_id}/issue?maxResults=${p.max_results}&fields=${p.fields}`;
      const res = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Sprint issues: ${res.status} ${await res.text()}`);
      return ok(await res.json());
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_get_epic_issues", {
    title: "Get Epic Issues",
    description: "Get all child issues of an Epic. Tries parent link, Epic Link field, and issueFunction in sequence.",
    inputSchema: EpicIssuesInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const fieldList = p.fields;
      const maxR = p.max_results;
      const queries = [
        `parent = "${p.epic_key}"`,
        `"Epic Link" = "${p.epic_key}"`,
        `issueFunction in issuesScopedToEpic("${p.epic_key}")`,
      ];
      for (const jql of queries) {
        try {
          const path = `/search?jql=${encodeURIComponent(jql)}&maxResults=${maxR}&fields=${fieldList}`;
          const result = await jiraRequest(accessToken, instanceUrl, path) as { issues?: unknown[] };
          if (result && Array.isArray(result.issues) && result.issues.length > 0) {
            return ok(result);
          }
        } catch {
          // try next strategy
        }
      }
      const path = `/search?jql=${encodeURIComponent(queries[0])}&maxResults=${maxR}&fields=${fieldList}`;
      return ok(await jiraRequest(accessToken, instanceUrl, path));
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_get_worklogs", {
    title: "Get Issue Worklogs",
    description: "Get all work log entries for a Jira issue. Returns author, time spent, start date, and comment.",
    inputSchema: IssueKeyInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const raw = await jiraRequest(accessToken, instanceUrl, `/issue/${p.issue_key}/worklog`) as {
        worklogs?: Array<{
          id: string;
          author?: { displayName?: string };
          timeSpent?: string;
          timeSpentSeconds?: number;
          started?: string;
          comment?: string;
        }>;
      };
      const worklogs = (raw.worklogs ?? []).map((w) => ({
        id: w.id,
        author: w.author?.displayName ?? "Unknown",
        timeSpent: w.timeSpent,
        timeSpentSeconds: w.timeSpentSeconds,
        started: w.started,
        comment: w.comment,
      }));
      return ok({ total: worklogs.length, worklogs });
    } catch (e) { return err(e); }
  });

  // ── GreenHopper / Velocity tools ─────────────────────────────────────────────

  server.registerTool("jira_get_sprint_velocity", {
    title: "Get Sprint Velocity",
    description: "Get velocity chart data for a board using GreenHopper API. Returns committed/completed story points per sprint with rolling average and trend.",
    inputSchema: BoardIdInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const base = instanceUrl.replace(/\/$/, "");
      const url = `${base}/rest/greenhopper/1.0/rapid/charts/velocity?rapidViewId=${p.board_id}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Velocity: ${res.status} ${await res.text()}`);
      const data = await res.json() as {
        velocityStatEntries?: Record<string, { estimated?: { value?: number; text?: string }; completed?: { value?: number; text?: string } }>;
        sprints?: Array<{ id: number; name?: string }>;
      };

      const sprintMap: Record<string, string> = {};
      for (const s of (data.sprints ?? [])) {
        sprintMap[String(s.id)] = s.name ?? String(s.id);
      }

      const entries = Object.entries(data.velocityStatEntries ?? {}).map(([sprintId, v]) => ({
        sprint_id: sprintId,
        sprint_name: sprintMap[sprintId] ?? sprintId,
        committed_sp: v.estimated?.value ?? 0,
        committed_text: v.estimated?.text ?? "0",
        completed_sp: v.completed?.value ?? 0,
        completed_text: v.completed?.text ?? "0",
      }));

      // Rolling 3-sprint average
      const n = entries.length;
      const recent3 = entries.slice(-3).map((e) => e.completed_sp);
      const older3  = entries.slice(Math.max(0, n - 6), n - 3).map((e) => e.completed_sp);
      const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      const recentAvg = avg(recent3);
      const olderAvg  = avg(older3);
      let trend: "improving" | "stable" | "declining" = "stable";
      if (older3.length > 0) {
        if (recentAvg > olderAvg * 1.05) trend = "improving";
        else if (recentAvg < olderAvg * 0.95) trend = "declining";
      }

      return ok({
        sprints: entries,
        rolling_3sprint_avg: Math.round(recentAvg * 10) / 10,
        trend,
      });
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_get_sprint_report", {
    title: "Get Sprint Report",
    description: "Get detailed sprint report from GreenHopper API: completed, incomplete, punted, and added issues.",
    inputSchema: SprintReportInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const base = instanceUrl.replace(/\/$/, "");
      const url = `${base}/rest/greenhopper/1.0/rapid/charts/sprintreport?rapidViewId=${p.board_id}&sprintId=${p.sprint_id}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Sprint report: ${res.status} ${await res.text()}`);
      const data = await res.json() as {
        contents?: {
          completedIssues?: unknown[];
          incompletedIssues?: unknown[];
          puntedIssues?: unknown[];
          issuesCompletedInAnotherSprint?: unknown[];
          issuesNotCompletedInitialEstimate?: unknown;
        };
        sprint?: unknown;
      };
      return ok({
        sprint: data.sprint,
        completed_issues: data.contents?.completedIssues ?? [],
        incompleted_issues: data.contents?.incompletedIssues ?? [],
        punted_issues: data.contents?.puntedIssues ?? [],
        issues_completed_in_another_sprint: data.contents?.issuesCompletedInAnotherSprint ?? [],
        issues_not_completed_initial_estimate: data.contents?.issuesNotCompletedInitialEstimate,
      });
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_list_dashboards", {
    title: "List Jira Dashboards",
    description: "List accessible Jira dashboards with owner and sharing info.",
    inputSchema: DashboardsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      let path = `/dashboard?maxResults=${p.max_results}`;
      if (p.filter) path += `&filter=${encodeURIComponent(p.filter)}`;
      const raw = await jiraRequest(accessToken, instanceUrl, path) as {
        dashboards?: Array<{ id: string; name?: string; owner?: { displayName?: string }; sharePermissions?: unknown[] }>;
      };
      const dashboards = (raw.dashboards ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        owner: d.owner?.displayName,
        sharePermissions: d.sharePermissions,
      }));
      return ok({ total: dashboards.length, dashboards });
    } catch (e) { return err(e); }
  });

  server.registerTool("jira_get_dashboard_chart_config", {
    title: "Get Dashboard Chart Config",
    description: "Extract Custom Charts gadget configurations from a Jira dashboard by scraping the Wallboard HTML.",
    inputSchema: DashboardChartInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => {
    try {
      const { accessToken, instanceUrl } = await getCreds();
      const base = instanceUrl.replace(/\/$/, "");
      const url = `${base}/plugins/servlet/Wallboard/?dashboardId=${p.dashboard_id}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "text/html" },
      });
      if (!res.ok) throw new Error(`Dashboard HTML: ${res.status}`);
      const html = await res.text();

      // Extract gadget items: look for data-id attributes and gadget preference JSON
      const gadgets: Array<{
        gadget_id: string;
        title: string | null;
        chart_config_raw: string | null;
        decoded_config: Record<string, unknown> | null;
      }> = [];

      // Find gadget containers — match <div ... data-id="N" ...>
      const gadgetPattern = /data-id="(\d+)"[^>]*>/g;
      let m: RegExpExecArray | null;
      const seenIds = new Set<string>();
      while ((m = gadgetPattern.exec(html)) !== null) {
        const gadgetId = m[1];
        if (seenIds.has(gadgetId)) continue;
        seenIds.add(gadgetId);

        // Look for userPrefs JSON blob near this gadget id in the HTML
        const snippet = html.slice(Math.max(0, m.index - 100), m.index + 5000);

        // Extract title
        const titleMatch = snippet.match(/class="gadget-title[^"]*"[^>]*>\s*([^<]+)/);
        const title = titleMatch ? titleMatch[1].trim() : null;

        // Look for chartConfig or userPrefs JSON
        let chartConfigRaw: string | null = null;
        let decodedConfig: Record<string, unknown> | null = null;

        const prefsMatch = snippet.match(/userPrefs\s*[:=]\s*(\{[^}]+\})/);
        if (prefsMatch) {
          chartConfigRaw = prefsMatch[1];
          try { decodedConfig = JSON.parse(prefsMatch[1]); } catch { /* ignore */ }
        }

        // Also look for chartConfig parameter specifically
        const chartConfigMatch = snippet.match(/"chartConfig"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (chartConfigMatch) {
          const raw = chartConfigMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
          chartConfigRaw = raw;
          try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            decodedConfig = {
              source_type: parsed.sourceType ?? parsed.source_type,
              jql: parsed.jql ?? parsed.filter,
              chart_by: parsed.chartBy ?? parsed.chart_by,
              group_by: parsed.groupBy ?? parsed.group_by,
              calculation: parsed.calculation,
              chart_type: parsed.chartType ?? parsed.chart_type,
              ...parsed,
            };
          } catch { /* ignore */ }
        }

        gadgets.push({ gadget_id: gadgetId, title, chart_config_raw: chartConfigRaw, decoded_config: decodedConfig });
      }

      return ok({ dashboard_id: p.dashboard_id, gadget_count: gadgets.length, gadgets });
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
