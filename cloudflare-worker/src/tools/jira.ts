/**
 * Jira MCP Tools
 * Đăng ký tất cả tools liên quan đến Jira vào McpServer instance.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jiraRequest } from "../atlassian";

type GetCreds = () => Promise<{ accessToken: string; cloudId: string }>;

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
      jql: z.string().describe(
        "JQL query. Ví dụ: 'project = PROJ AND status = Open', 'assignee = currentUser() ORDER BY updated DESC'"
      ),
      max_results: z.number().int().min(1).max(50).optional().default(20),
      fields: z
        .string()
        .optional()
        .default("summary,status,assignee,priority,issuetype,created,updated,description"),
    },
    async ({ jql, max_results, fields }) => {
      const { accessToken, cloudId } = await getCreds();
      const { jiraUrl } = getEnvUrls();
      const data = await jiraRequest(
        accessToken, cloudId, jiraUrl,
        `/search?jql=${encodeURIComponent(jql)}&maxResults=${max_results}&fields=${fields}`
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── jira_get_issue ─────────────────────────────────────────────────────────
  server.tool(
    "jira_get_issue",
    "Get full details of a specific Jira issue including comments and attachments",
    {
      issue_key: z.string().describe("Issue key, ví dụ: PROJ-123"),
      expand: z.string().optional().default("renderedFields,names,changelog"),
    },
    async ({ issue_key, expand }) => {
      const { accessToken, cloudId } = await getCreds();
      const { jiraUrl } = getEnvUrls();
      const data = await jiraRequest(
        accessToken, cloudId, jiraUrl,
        `/issue/${issue_key}?expand=${expand}`
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── jira_create_issue ──────────────────────────────────────────────────────
  server.tool(
    "jira_create_issue",
    "Create a new Jira issue (Task, Bug, Story, Epic, Sub-task, ...)",
    {
      project_key: z.string().describe("Project key, ví dụ: PROJ"),
      summary: z.string().describe("Tiêu đề issue"),
      issue_type: z
        .string()
        .optional()
        .default("Task")
        .describe("Loại issue: Task, Bug, Story, Epic, Sub-task"),
      description: z
        .string()
        .optional()
        .describe("Mô tả issue (plain text, sẽ được convert sang ADF)"),
      priority: z
        .string()
        .optional()
        .default("Medium")
        .describe("Mức ưu tiên: Highest, High, Medium, Low, Lowest"),
      assignee_account_id: z
        .string()
        .optional()
        .describe("accountId của người được assign (dùng jira_search_users để tìm)"),
      labels: z.array(z.string()).optional().describe("Danh sách labels"),
      parent_key: z
        .string()
        .optional()
        .describe("Parent issue key (bắt buộc nếu issue_type là Sub-task)"),
    },
    async ({
      project_key,
      summary,
      issue_type,
      description,
      priority,
      assignee_account_id,
      labels,
      parent_key,
    }) => {
      const { accessToken, cloudId } = await getCreds();
      const { jiraUrl } = getEnvUrls();

      const fields: Record<string, unknown> = {
        project: { key: project_key },
        summary,
        issuetype: { name: issue_type },
        priority: { name: priority },
      };

      if (description) {
        // Atlassian Document Format (ADF) cho Cloud API v3
        fields.description = {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: description }],
            },
          ],
        };
      }

      if (assignee_account_id) {
        fields.assignee = { accountId: assignee_account_id };
      }

      if (labels?.length) {
        fields.labels = labels;
      }

      if (parent_key) {
        fields.parent = { key: parent_key };
      }

      const data = await jiraRequest(
        accessToken, cloudId, jiraUrl,
        "/issue", "POST", { fields }
      );
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
      assignee_account_id: z.string().optional(),
      labels: z.array(z.string()).optional(),
    },
    async ({
      issue_key,
      summary,
      description,
      priority,
      assignee_account_id,
      labels,
    }) => {
      const { accessToken, cloudId } = await getCreds();
      const { jiraUrl } = getEnvUrls();

      const fields: Record<string, unknown> = {};

      if (summary) fields.summary = summary;
      if (description) {
        fields.description = {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: description }],
            },
          ],
        };
      }
      if (priority) fields.priority = { name: priority };
      if (assignee_account_id !== undefined) {
        fields.assignee = assignee_account_id ? { accountId: assignee_account_id } : null;
      }
      if (labels) fields.labels = labels;

      await jiraRequest(
        accessToken, cloudId, jiraUrl,
        `/issue/${issue_key}`, "PUT", { fields }
      );
      return {
        content: [{ type: "text", text: `Issue ${issue_key} updated successfully.` }],
      };
    }
  );

  // ── jira_get_transitions ───────────────────────────────────────────────────
  server.tool(
    "jira_get_transitions",
    "Get available status transitions for a Jira issue",
    { issue_key: z.string() },
    async ({ issue_key }) => {
      const { accessToken, cloudId } = await getCreds();
      const { jiraUrl } = getEnvUrls();
      const data = await jiraRequest(
        accessToken, cloudId, jiraUrl,
        `/issue/${issue_key}/transitions`
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── jira_transition_issue ──────────────────────────────────────────────────
  server.tool(
    "jira_transition_issue",
    "Change the status of a Jira issue (e.g., move to In Progress, Done)",
    {
      issue_key: z.string(),
      transition_id: z
        .string()
        .describe("ID của transition — lấy từ jira_get_transitions"),
      comment: z
        .string()
        .optional()
        .describe("Comment kèm theo khi chuyển status (tuỳ chọn)"),
    },
    async ({ issue_key, transition_id, comment }) => {
      const { accessToken, cloudId } = await getCreds();
      const { jiraUrl } = getEnvUrls();

      const body: Record<string, unknown> = {
        transition: { id: transition_id },
      };

      if (comment) {
        body.update = {
          comment: [
            {
              add: {
                body: {
                  type: "doc",
                  version: 1,
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: comment }],
                    },
                  ],
                },
              },
            },
          ],
        };
      }

      await jiraRequest(
        accessToken, cloudId, jiraUrl,
        `/issue/${issue_key}/transitions`, "POST", body
      );
      return {
        content: [
          {
            type: "text",
            text: `Issue ${issue_key} transitioned to transition ID ${transition_id} successfully.`,
          },
        ],
      };
    }
  );

  // ── jira_add_comment ───────────────────────────────────────────────────────
  server.tool(
    "jira_add_comment",
    "Add a comment to a Jira issue",
    {
      issue_key: z.string(),
      comment: z.string().describe("Nội dung comment (plain text)"),
    },
    async ({ issue_key, comment }) => {
      const { accessToken, cloudId } = await getCreds();
      const { jiraUrl } = getEnvUrls();

      const data = await jiraRequest(
        accessToken, cloudId, jiraUrl,
        `/issue/${issue_key}/comment`, "POST",
        {
          body: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: comment }],
              },
            ],
          },
        }
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
      query: z.string().optional().describe("Filter projects by name or key"),
    },
    async ({ max_results, query }) => {
      const { accessToken, cloudId } = await getCreds();
      const { jiraUrl } = getEnvUrls();

      let path = `/project/search?maxResults=${max_results}&expand=description`;
      if (query) path += `&query=${encodeURIComponent(query)}`;

      const data = await jiraRequest(accessToken, cloudId, jiraUrl, path);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── jira_search_users ──────────────────────────────────────────────────────
  server.tool(
    "jira_search_users",
    "Search for Jira users by name or email (useful to find accountId for assignment)",
    {
      query: z.string().describe("Tên hoặc email để tìm user"),
      max_results: z.number().int().min(1).max(50).optional().default(10),
    },
    async ({ query, max_results }) => {
      const { accessToken, cloudId } = await getCreds();
      const { jiraUrl } = getEnvUrls();
      const data = await jiraRequest(
        accessToken, cloudId, jiraUrl,
        `/user/search?query=${encodeURIComponent(query)}&maxResults=${max_results}`
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
      const { accessToken, cloudId } = await getCreds();
      const { jiraUrl } = getEnvUrls();
      const data = await jiraRequest(
        accessToken, cloudId, jiraUrl,
        `/project/${project_key}`
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
