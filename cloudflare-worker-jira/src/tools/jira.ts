/**
 * Jira Data Center MCP Tools.
 * DC dùng REST API v2: ${JIRA_URL}/rest/api/2/...
 * Không có cloud_id, không có ADF (description là plain text wiki markup).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jiraRequest } from "../atlassian";

type GetCreds = () => Promise<{ accessToken: string; refreshToken: string }>;

export function registerJiraTools(
  server: McpServer,
  getCreds: GetCreds,
  getEnvUrls: () => { jiraUrl: string; confluenceUrl: string }
): void {

  // ── jira_search ────────────────────────────────────────────────────────────
  server.tool(
    "jira_search",
    "Search Jira issues using JQL (Jira Query Language)",
    {
      jql: z.string().describe("JQL query, ví dụ: 'project = PROJ AND status = Open ORDER BY updated DESC'"),
      max_results: z.number().int().min(1).max(50).optional().default(20),
      fields: z.string().optional().default("summary,status,assignee,priority,issuetype,created,updated,description"),
    },
    async ({ jql, max_results, fields }) => {
      const { accessToken } = await getCreds();
      const { jiraUrl } = getEnvUrls();
      const data = await jiraRequest(
        accessToken, jiraUrl,
        `/search?jql=${encodeURIComponent(jql)}&maxResults=${max_results}&fields=${fields}`
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── jira_get_issue ─────────────────────────────────────────────────────────
  server.tool(
    "jira_get_issue",
    "Get full details of a specific Jira issue",
    {
      issue_key: z.string().describe("Issue key, ví dụ: PROJ-123"),
      expand: z.string().optional().default("renderedFields,names,changelog"),
    },
    async ({ issue_key, expand }) => {
      const { accessToken } = await getCreds();
      const { jiraUrl } = getEnvUrls();
      const data = await jiraRequest(accessToken, jiraUrl, `/issue/${issue_key}?expand=${expand}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── jira_create_issue ──────────────────────────────────────────────────────
  server.tool(
    "jira_create_issue",
    "Create a new Jira issue",
    {
      project_key: z.string().describe("Project key, ví dụ: PROJ"),
      summary: z.string().describe("Tiêu đề issue"),
      issue_type: z.string().optional().default("Task").describe("Task, Bug, Story, Epic, Sub-task"),
      description: z.string().optional().describe("Mô tả issue (plain text / wiki markup)"),
      priority: z.string().optional().default("Medium").describe("Highest, High, Medium, Low, Lowest"),
      assignee_name: z.string().optional().describe("Username của người được assign (DC dùng username, không phải accountId)"),
      labels: z.array(z.string()).optional(),
      parent_key: z.string().optional().describe("Parent issue key nếu là Sub-task"),
    },
    async ({ project_key, summary, issue_type, description, priority, assignee_name, labels, parent_key }) => {
      const { accessToken } = await getCreds();
      const { jiraUrl } = getEnvUrls();

      const fields: Record<string, unknown> = {
        project: { key: project_key },
        summary,
        issuetype: { name: issue_type },
        priority: { name: priority },
      };

      // DC dùng plain text hoặc wiki markup, không phải ADF
      if (description) fields.description = description;
      if (assignee_name) fields.assignee = { name: assignee_name };
      if (labels?.length) fields.labels = labels;
      if (parent_key) fields.parent = { key: parent_key };

      const data = await jiraRequest(accessToken, jiraUrl, "/issue", "POST", { fields });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── jira_update_issue ──────────────────────────────────────────────────────
  server.tool(
    "jira_update_issue",
    "Update fields of an existing Jira issue",
    {
      issue_key: z.string(),
      summary: z.string().optional(),
      description: z.string().optional(),
      priority: z.string().optional(),
      assignee_name: z.string().optional().describe("Username (DC), để trống để unassign"),
      labels: z.array(z.string()).optional(),
    },
    async ({ issue_key, summary, description, priority, assignee_name, labels }) => {
      const { accessToken } = await getCreds();
      const { jiraUrl } = getEnvUrls();
      const fields: Record<string, unknown> = {};
      if (summary) fields.summary = summary;
      if (description !== undefined) fields.description = description;
      if (priority) fields.priority = { name: priority };
      if (assignee_name !== undefined) fields.assignee = assignee_name ? { name: assignee_name } : null;
      if (labels) fields.labels = labels;
      await jiraRequest(accessToken, jiraUrl, `/issue/${issue_key}`, "PUT", { fields });
      return { content: [{ type: "text", text: `Issue ${issue_key} updated successfully.` }] };
    }
  );

  // ── jira_get_transitions ───────────────────────────────────────────────────
  server.tool(
    "jira_get_transitions",
    "Get available status transitions for a Jira issue",
    { issue_key: z.string() },
    async ({ issue_key }) => {
      const { accessToken } = await getCreds();
      const { jiraUrl } = getEnvUrls();
      const data = await jiraRequest(accessToken, jiraUrl, `/issue/${issue_key}/transitions`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── jira_transition_issue ──────────────────────────────────────────────────
  server.tool(
    "jira_transition_issue",
    "Change the status of a Jira issue",
    {
      issue_key: z.string(),
      transition_id: z.string().describe("ID của transition — lấy từ jira_get_transitions"),
      comment: z.string().optional(),
    },
    async ({ issue_key, transition_id, comment }) => {
      const { accessToken } = await getCreds();
      const { jiraUrl } = getEnvUrls();
      const body: Record<string, unknown> = { transition: { id: transition_id } };
      if (comment) {
        // DC comment body là plain text
        body.update = { comment: [{ add: { body: comment } }] };
      }
      await jiraRequest(accessToken, jiraUrl, `/issue/${issue_key}/transitions`, "POST", body);
      return { content: [{ type: "text", text: `Issue ${issue_key} transitioned successfully.` }] };
    }
  );

  // ── jira_add_comment ───────────────────────────────────────────────────────
  server.tool(
    "jira_add_comment",
    "Add a comment to a Jira issue",
    {
      issue_key: z.string(),
      comment: z.string().describe("Nội dung comment (plain text / wiki markup)"),
    },
    async ({ issue_key, comment }) => {
      const { accessToken } = await getCreds();
      const { jiraUrl } = getEnvUrls();
      // DC: body là plain text string, không phải ADF object
      const data = await jiraRequest(
        accessToken, jiraUrl,
        `/issue/${issue_key}/comment`, "POST",
        { body: comment }
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── jira_get_projects ──────────────────────────────────────────────────────
  server.tool(
    "jira_get_projects",
    "List all accessible Jira projects",
    {
      max_results: z.number().int().min(1).max(100).optional().default(50),
      query: z.string().optional().describe("Filter by name or key"),
    },
    async ({ max_results, query }) => {
      const { accessToken } = await getCreds();
      const { jiraUrl } = getEnvUrls();
      // DC dùng /project thay vì /project/search
      let path = `/project?maxResults=${max_results}&expand=description`;
      if (query) path += `&query=${encodeURIComponent(query)}`;
      const data = await jiraRequest(accessToken, jiraUrl, path);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── jira_search_users ──────────────────────────────────────────────────────
  server.tool(
    "jira_search_users",
    "Search for Jira users by name or email",
    {
      query: z.string().describe("Tên hoặc email để tìm user"),
      max_results: z.number().int().min(1).max(50).optional().default(10),
    },
    async ({ query, max_results }) => {
      const { accessToken } = await getCreds();
      const { jiraUrl } = getEnvUrls();
      // DC dùng /user/search?username= thay vì ?query=
      const data = await jiraRequest(
        accessToken, jiraUrl,
        `/user/search?username=${encodeURIComponent(query)}&maxResults=${max_results}`
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── jira_get_issue_types ───────────────────────────────────────────────────
  server.tool(
    "jira_get_issue_types",
    "Get all issue types available in a Jira project",
    { project_key: z.string() },
    async ({ project_key }) => {
      const { accessToken } = await getCreds();
      const { jiraUrl } = getEnvUrls();
      const data = await jiraRequest(accessToken, jiraUrl, `/project/${project_key}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
