# Implementation Prompt — Phase 1 & 2
# MCP Atlassian DC: Tool Optimization + Monorepo Restructure

> Đây là prompt tự chứa đủ context để thực hiện trong một session mới.
> KHÔNG deploy split workers cho đến khi có xác nhận rõ ràng sau khi test xong.

---

## 1. PROJECT CONTEXT

**Repo:** `tuongbeo/mcp-atlassian-dc`, branch `cloudflare-worker-multi`
**Local path:** `/Users/tuongbeo/Development/mcp-atlassian-dc`
**Current worker:** `cloudflare-worker-multi/` → deployed as `atlassian.tuongbeo.workers.dev`
**Cloudflare worker name:** `atlassian` (in wrangler.jsonc)
**KV namespace ID:** `af2e3b157a1b47f7883652ef93c6e69a`
**Cloudflare Account ID:** `dbd8cb300c7d9d0adc0108f201c19786`

**Current tool count:** 18 Jira + 30 Confluence = 48 total
**Target tool count after Phase 1:** ~15 Jira + ~22 Confluence = ~37 total (still under 48 limit)

**Source files to modify in Phase 1:**
- `cloudflare-worker-multi/src/tools/jira.ts`
- `cloudflare-worker-multi/src/tools/confluence.ts`

**Deployment command (same as always):**
```bash
cd /Users/tuongbeo/Development/mcp-atlassian-dc/cloudflare-worker-multi
npx wrangler deploy --dry-run   # validate first
npx wrangler deploy             # deploy
```

---

## 2. INVARIANTS — DO NOT CHANGE

These must remain identical after all changes:

1. **Sub derivation formula** in `oauth.ts`:
   `sub = "${atlassian_hostname}:${sha256(rawClientId:serviceType)[:16]}"`
   Example: `"jira.pila.vn:a1b2c3d4e5f6a7b8"` — do NOT touch oauth.ts in Phase 1.

2. **KV key schema:** `token:{sub}`, `refresh:{uuid}`, `canonical_refresh:{sub}` — unchanged.

3. **Service type check** in `mcp-agent.ts`: token.serviceType must match the endpoint's service — unchanged.

4. **Tool registration pattern** in `registerJiraTools(server, getCreds)` and `registerConfluenceTools(server, getCreds)` — same pattern, just different tool definitions.

5. **`atlassian.tuongbeo.workers.dev` MCP URLs** remain `/jira/mcp` and `/confluence/mcp` throughout Phase 1 and 2. URL change only happens in Phase 3 (separate workers, separate domains).

---

## 3. EXECUTION ORDER

```
Step 1:  Read current jira.ts and confluence.ts fully before any edits
Step 2:  Apply all Phase 1 changes to jira.ts
Step 3:  Apply all Phase 1 changes to confluence.ts
Step 4:  npx wrangler deploy --dry-run (must pass with 0 errors)
Step 5:  npx wrangler deploy (deploy to atlassian.tuongbeo.workers.dev)
Step 6:  Run TC-PHASE1 test checklist (validate all changed tools)
Step 7:  git commit -m "feat(tools): optimize tool set - merge/remove/upgrade/add" && git push
Step 8:  Create Phase 2 directory structure (does NOT affect running worker)
Step 9:  Write shared files and per-worker index.ts files
Step 10: npx wrangler deploy --dry-run for BOTH new workers (validation only)
Step 11: git commit -m "feat(repo): monorepo structure for split worker deployment" && git push
Step 12: Report completion — WAIT for explicit Phase 3 confirmation
```

---

## 4. PHASE 1 — TOOL CHANGES IN `cloudflare-worker-multi`

### 4.1 JIRA: Tools to REMOVE completely

Remove the entire `server.registerTool(...)` block for each of these.
Keep the Zod schema definitions (they serve as documentation) with a `// REMOVED:` comment.

| Tool | Reason |
|---|---|
| `jira_list_dashboards` | Dashboards are visual UI, Claude cannot render them |
| `jira_get_issue_types` | Types are fixed: Story/Bug/Task/Epic/Sub-task. Utility tool with near-zero usage |
| `jira_get_worklogs` | Per-issue worklogs → N+1 problem. Replaced by new `jira_get_sprint_worklogs` |

### 4.2 JIRA: Tools to MERGE

#### `jira_get_transitions` + `jira_transition_issue` → `jira_transition`

Remove both existing registrations. Add new registration:

```typescript
const JiraTransitionInput = z.object({
  issue_key: z.string().describe("Issue key, e.g. KEY-123"),
  transition_id: z.string().optional().describe(
    "Transition ID from listing. If omitted, returns list of available transitions."
  ),
  comment: z.string().optional().describe("Optional comment when performing transition"),
});

server.registerTool("jira_transition", {
  description: "List available transitions for an issue, or execute a specific transition. " +
    "Call without transition_id to get the list, then call again with transition_id to execute.",
  inputSchema: JiraTransitionInput,
}, async (p) => {
  const { accessToken, instanceUrl } = await getCreds();
  try {
    if (!p.transition_id) {
      // List mode
      const res = await jiraRequest(accessToken, instanceUrl,
        `/rest/api/2/issue/${p.issue_key}/transitions`);
      const data = await res.json<{ transitions: Array<{ id: string; name: string; to: { name: string } }> }>();
      return ok(data.transitions.map(t => ({ id: t.id, name: t.name, to: t.to.name })));
    }
    // Execute mode
    const body: Record<string, unknown> = { transition: { id: p.transition_id } };
    if (p.comment) {
      body.update = { comment: [{ add: { body: p.comment } }] };
    }
    await jiraRequest(accessToken, instanceUrl,
      `/rest/api/2/issue/${p.issue_key}/transitions`,
      { method: "POST", body: JSON.stringify(body) });
    return ok(`Issue ${p.issue_key} transitioned successfully.`);
  } catch (e) { return err(e); }
});
```

#### `jira_get_agile_boards` + `jira_get_sprints` → `jira_list_sprints`

Remove both. Add:

```typescript
const JiraListSprintsInput = z.object({
  project_key: z.string().optional().describe("Project key to auto-resolve board. Required if board_id not provided."),
  board_id: z.number().int().optional().describe("Board ID. If not provided, resolved from project_key."),
  state: z.enum(["active", "future", "closed"]).default("active").optional(),
  max_results: z.number().int().min(1).max(50).default(10).optional(),
});

server.registerTool("jira_list_sprints", {
  description: "List sprints for a project or board. Resolves board from project_key automatically if board_id not provided.",
  inputSchema: JiraListSprintsInput,
}, async (p) => {
  const { accessToken, instanceUrl } = await getCreds();
  try {
    let boardId = p.board_id;
    if (!boardId) {
      if (!p.project_key) return err(new Error("Provide either project_key or board_id"));
      const boardRes = await jiraRequest(accessToken, instanceUrl,
        `/rest/agile/1.0/board?projectKeyOrId=${p.project_key}&type=scrum`);
      const boardData = await boardRes.json<{ values: Array<{ id: number; name: string }> }>();
      if (!boardData.values?.length) return err(new Error(`No Scrum board found for project ${p.project_key}`));
      boardId = boardData.values[0].id;
    }
    const sprintRes = await jiraRequest(accessToken, instanceUrl,
      `/rest/agile/1.0/board/${boardId}/sprint?state=${p.state ?? "active"}&maxResults=${p.max_results ?? 10}`);
    const sprintData = await sprintRes.json<{ values: unknown[] }>();
    return ok({ board_id: boardId, sprints: sprintData.values });
  } catch (e) { return err(e); }
});
```

#### `jira_get_sprint_report` + `jira_get_sprint_velocity` → `jira_sprint_analytics`

Remove both. Add:

```typescript
const JiraSprintAnalyticsInput = z.object({
  board_id: z.string().describe("Board (rapidView) ID"),
  sprint_id: z.string().optional().describe("Sprint ID. Required for type=report. Omit for type=velocity."),
  type: z.enum(["report", "velocity", "both"]).default("report"),
});

server.registerTool("jira_sprint_analytics", {
  description: "Sprint analytics: report (completed/incomplete issues) or velocity (story points per sprint). " +
    "type=report requires sprint_id. type=velocity returns all historical sprints.",
  inputSchema: JiraSprintAnalyticsInput,
}, async (p) => {
  const { accessToken, instanceUrl } = await getCreds();
  try {
    const result: Record<string, unknown> = {};
    if (p.type === "report" || p.type === "both") {
      if (!p.sprint_id) return err(new Error("sprint_id required for type=report"));
      const r = await jiraRequest(accessToken, instanceUrl,
        `/rest/greenhopper/1.0/rapid/charts/sprintreport?rapidViewId=${p.board_id}&sprintId=${p.sprint_id}`);
      result.report = await r.json();
    }
    if (p.type === "velocity" || p.type === "both") {
      const r = await jiraRequest(accessToken, instanceUrl,
        `/rest/greenhopper/1.0/rapid/charts/velocity?rapidViewId=${p.board_id}`);
      result.velocity = await r.json();
    }
    return ok(p.type === "both" ? result : (result.report ?? result.velocity));
  } catch (e) { return err(e); }
});
```

### 4.3 JIRA: Tools to UPGRADE

#### `jira_search` — add `include_changelog` param

Locate the existing `jira_search` registration. Change the Zod schema to add:
```typescript
include_changelog: z.boolean().default(false).optional()
  .describe("When true, includes full status transition history per issue. Use for performance/cycle-time reporting."),
```

In the handler, modify the `expand` parameter:
```typescript
const expandParam = p.include_changelog
  ? "renderedFields,names,changelog"
  : "renderedFields,names";
// append &expand=... to the search URL
```

The Jira search endpoint already accepts `expand` param. Current URL pattern:
`/rest/api/2/search?jql=...&maxResults=...&fields=...`
Add: `&expand=${expandParam}` when `include_changelog` is true.

### 4.4 JIRA: New Tools

#### `jira_bulk_create_issues`

```typescript
const BulkIssueItem = z.object({
  project_key: z.string(),
  summary: z.string(),
  issue_type: z.string().default("Story").optional(),
  description: z.string().optional(),
  assignee_name: z.string().optional().describe("DC username"),
  priority: z.string().default("Medium").optional(),
  parent_key: z.string().optional().describe("Parent Epic or Story key for sub-tasks"),
  labels: z.array(z.string()).optional(),
  custom_fields: z.record(z.unknown()).optional(),
});
const JiraBulkCreateInput = z.object({
  issues: z.array(BulkIssueItem).min(1).max(50),
});

server.registerTool("jira_bulk_create_issues", {
  description: "Create multiple Jira issues in a single call. Returns array of created issue keys. " +
    "Use for creating all Stories/Tasks under an Epic after writing a PRD.",
  inputSchema: JiraBulkCreateInput,
}, async (p) => {
  const { accessToken, instanceUrl } = await getCreds();
  try {
    const issueUpdates = p.issues.map(issue => {
      const fields: Record<string, unknown> = {
        project: { key: issue.project_key },
        summary: issue.summary,
        issuetype: { name: issue.issue_type ?? "Story" },
        priority: { name: issue.priority ?? "Medium" },
      };
      if (issue.description) fields.description = issue.description;
      if (issue.assignee_name) fields.assignee = { name: issue.assignee_name };
      if (issue.labels?.length) fields.labels = issue.labels;
      if (issue.parent_key) fields.parent = { key: issue.parent_key };
      if (issue.custom_fields) Object.assign(fields, issue.custom_fields);
      return { fields };
    });
    const res = await jiraRequest(accessToken, instanceUrl,
      "/rest/api/2/issue/bulk",
      { method: "POST", body: JSON.stringify({ issueUpdates }) });
    const data = await res.json<{ issues: Array<{ id: string; key: string }>; errors: unknown[] }>();
    return ok({ created: data.issues.map(i => i.key), errors: data.errors });
  } catch (e) { return err(e); }
});
```

#### `jira_get_backlog`

```typescript
const JiraGetBacklogInput = z.object({
  project_key: z.string().describe("Project key, e.g. KEY"),
  max_results: z.number().int().min(1).max(50).default(30).optional(),
  fields: z.string().default("summary,status,assignee,priority,issuetype,story_points").optional(),
});

server.registerTool("jira_get_backlog", {
  description: "Get issues in the backlog (not assigned to any sprint) for a project. " +
    "Useful for sprint planning and backlog grooming.",
  inputSchema: JiraGetBacklogInput,
}, async (p) => {
  const { accessToken, instanceUrl } = await getCreds();
  try {
    const jql = `project="${p.project_key}" AND sprint is EMPTY AND resolution is EMPTY ORDER BY priority DESC, created DESC`;
    const res = await jiraRequest(accessToken, instanceUrl,
      `/rest/api/2/search?jql=${encodeURIComponent(jql)}&maxResults=${p.max_results ?? 30}&fields=${p.fields}`);
    const data = await res.json<{ total: number; issues: unknown[] }>();
    return ok({ total: data.total, issues: data.issues });
  } catch (e) { return err(e); }
});
```

#### `jira_get_sprint_worklogs`

```typescript
const JiraSprintWorklogsInput = z.object({
  sprint_id: z.number().int().describe("Sprint ID"),
  max_issues: z.number().int().min(1).max(50).default(50).optional(),
});

server.registerTool("jira_get_sprint_worklogs", {
  description: "Aggregate all work logs for a sprint, grouped by user. " +
    "Returns total time logged per person with breakdown by issue. " +
    "Use for team performance reporting instead of calling jira_get_worklogs per issue.",
  inputSchema: JiraSprintWorklogsInput,
}, async (p) => {
  const { accessToken, instanceUrl } = await getCreds();
  try {
    // Step 1: Get all sprint issues with worklog field
    const issueRes = await jiraRequest(accessToken, instanceUrl,
      `/rest/agile/1.0/sprint/${p.sprint_id}/issue?fields=worklog,summary,assignee&maxResults=${p.max_issues ?? 50}`);
    const issueData = await issueRes.json<{
      issues: Array<{
        key: string;
        fields: {
          summary: string;
          worklog: { worklogs: Array<{ author: { name: string; displayName: string }; timeSpentSeconds: number; started: string; comment?: string }> };
        };
      }>;
    }>();

    // Step 2: Aggregate by user
    const userMap: Record<string, { displayName: string; total_seconds: number; entries: unknown[] }> = {};
    for (const issue of issueData.issues) {
      for (const wl of (issue.fields.worklog?.worklogs ?? [])) {
        const username = wl.author.name;
        if (!userMap[username]) {
          userMap[username] = { displayName: wl.author.displayName, total_seconds: 0, entries: [] };
        }
        userMap[username].total_seconds += wl.timeSpentSeconds;
        userMap[username].entries.push({
          issue_key: issue.key,
          summary: issue.fields.summary,
          started: wl.started,
          seconds: wl.timeSpentSeconds,
          hours: Math.round(wl.timeSpentSeconds / 3600 * 10) / 10,
          comment: wl.comment ?? "",
        });
      }
    }

    const users = Object.entries(userMap).map(([username, data]) => ({
      username,
      ...data,
      total_hours: Math.round(data.total_seconds / 3600 * 10) / 10,
    })).sort((a, b) => b.total_seconds - a.total_seconds);

    return ok({ sprint_id: p.sprint_id, users, total_issues_with_worklogs: issueData.issues.filter(i => i.fields.worklog?.worklogs?.length).length });
  } catch (e) { return err(e); }
});
```

---

### 4.5 CONFLUENCE: Tools to REMOVE completely

| Tool | Reason |
|---|---|
| `confluence_get_page_analytics` | Analytics plugin not installed, always returns fallback message |
| `confluence_get_space_permissions` | Admin-only, not needed in daily product workflow |
| `confluence_get_attachments` | Blocked by Claude.ai safety filter permanently |
| `confluence_upload_attachment` | Blocked by Claude.ai safety filter permanently |

### 4.6 CONFLUENCE: Tools to MERGE

#### `confluence_add_comment` + `confluence_get_page_comments` → `confluence_comments`

```typescript
const ConfluenceCommentsInput = z.object({
  page_id: z.string(),
  action: z.enum(["get", "add"]).default("get"),
  comment: z.string().optional().describe("Required when action=add"),
});

server.registerTool("confluence_comments", {
  description: "Get comments on a page (action=get) or add a new comment (action=add).",
  inputSchema: ConfluenceCommentsInput,
}, async (p) => {
  const { accessToken, instanceUrl } = await getCreds();
  try {
    if (p.action === "get") {
      const res = await confluenceRequest(accessToken, instanceUrl,
        `/rest/api/content/${p.page_id}/child/comment?expand=body.storage,version&limit=25`);
      const data = await res.json<{ results: unknown[] }>();
      return ok({ comments: data.results });
    }
    if (!p.comment) return err(new Error("comment is required when action=add"));
    const res = await confluenceRequest(accessToken, instanceUrl,
      `/rest/api/content/${p.page_id}/child/comment`,
      { method: "POST", body: JSON.stringify({
        type: "comment",
        body: { storage: { value: `<p>${p.comment}</p>`, representation: "storage" } },
      })});
    return ok(await res.json());
  } catch (e) { return err(e); }
});
```

#### `confluence_get_labels` + `confluence_add_label` + `confluence_remove_label` → `confluence_labels`

```typescript
const ConfluenceLabelsInput = z.object({
  page_id: z.string(),
  action: z.enum(["get", "add", "remove"]).default("get"),
  labels: z.array(z.string()).optional().describe("Label names. Required for action=add or action=remove"),
});

server.registerTool("confluence_labels", {
  description: "Manage labels on a Confluence page. Get all labels, add new ones, or remove existing ones.",
  inputSchema: ConfluenceLabelsInput,
}, async (p) => {
  const { accessToken, instanceUrl } = await getCreds();
  try {
    if (p.action === "get") {
      const res = await confluenceRequest(accessToken, instanceUrl, `/rest/api/content/${p.page_id}/label`);
      return ok(await res.json());
    }
    if (!p.labels?.length) return err(new Error("labels array required for add/remove"));
    if (p.action === "add") {
      const body = p.labels.map(name => ({ prefix: "global", name }));
      const res = await confluenceRequest(accessToken, instanceUrl,
        `/rest/api/content/${p.page_id}/label`,
        { method: "POST", body: JSON.stringify(body) });
      return ok(await res.json());
    }
    // remove: DELETE one by one
    const results = [];
    for (const label of p.labels) {
      await confluenceRequest(accessToken, instanceUrl,
        `/rest/api/content/${p.page_id}/label/${encodeURIComponent(label)}`,
        { method: "DELETE" });
      results.push(`Removed label: ${label}`);
    }
    return ok(results);
  } catch (e) { return err(e); }
});
```

#### `confluence_get_page_history` + `confluence_get_page_versions` → `confluence_history`

```typescript
const ConfluenceHistoryInput = z.object({
  page_id: z.string(),
  detail: z.enum(["summary", "versions"]).default("summary")
    .describe("summary=creation and last update metadata. versions=full version list."),
  limit: z.number().int().min(1).max(50).default(10).optional(),
});

server.registerTool("confluence_history", {
  description: "Get page history. detail=summary returns created/modified metadata. " +
    "detail=versions returns full version list with authors.",
  inputSchema: ConfluenceHistoryInput,
}, async (p) => {
  const { accessToken, instanceUrl } = await getCreds();
  try {
    if (p.detail === "summary") {
      const res = await confluenceRequest(accessToken, instanceUrl, `/rest/api/content/${p.page_id}/history`);
      return ok(await res.json());
    }
    // versions — uses /experimental/ path (BUG-09 fix)
    const res = await confluenceRequest(accessToken, instanceUrl,
      `/rest/experimental/content/${p.page_id}/version?limit=${p.limit ?? 10}`);
    return ok(await res.json());
  } catch (e) { return err(e); }
});
```

#### `confluence_get_page_restrictions` + `confluence_set_page_restrictions` → `confluence_restrictions`

```typescript
const ConfluenceRestrictionsInput = z.object({
  page_id: z.string(),
  restrictions: z.array(z.object({
    operation: z.enum(["read", "update"]),
    users: z.array(z.string()).optional().describe("Usernames"),
    groups: z.array(z.string()).optional().describe("Group names"),
  })).optional().describe("If omitted, returns current restrictions. If provided (even empty array []), sets restrictions."),
});

server.registerTool("confluence_restrictions", {
  description: "Get or set page access restrictions. " +
    "Without restrictions param: returns current. " +
    "With restrictions=[]: removes all restrictions. " +
    "With restrictions=[...]: sets specified users/groups.",
  inputSchema: ConfluenceRestrictionsInput,
}, async (p) => {
  const { accessToken, instanceUrl } = await getCreds();
  try {
    if (p.restrictions === undefined) {
      // GET mode
      const res = await confluenceRequest(accessToken, instanceUrl,
        `/rest/api/content/${p.page_id}?expand=restrictions.read.restrictions.user,restrictions.read.restrictions.group,restrictions.update.restrictions.user,restrictions.update.restrictions.group`);
      const data = await res.json<{ restrictions: unknown }>();
      return ok(data.restrictions ?? {});
    }
    // SET mode — PUT with full operation arrays (BUG-10 fix: no DELETE)
    const buildOp = (op: string) => {
      const opEntry = p.restrictions!.find(r => r.operation === op);
      return {
        operation: op,
        restrictions: {
          user: (opEntry?.users ?? []).map(name => ({ type: "known", username: name })),
          group: (opEntry?.groups ?? []).map(name => ({ type: "group", name })),
        },
      };
    };
    const body = { results: [buildOp("read"), buildOp("update")] };
    const res = await confluenceRequest(accessToken, instanceUrl,
      `/rest/api/content/${p.page_id}/restriction`,
      { method: "PUT", body: JSON.stringify(body) });
    if (p.restrictions.length === 0) return ok("All restrictions removed.");
    return ok(await res.json());
  } catch (e) { return err(e); }
});
```

### 4.7 CONFLUENCE: Tools to UPGRADE

#### `confluence_get_page_children` — add `depth` param

Locate existing `confluence_get_page_children`. Modify schema:
```typescript
depth: z.number().int().min(1).max(5).default(1).optional()
  .describe("How many levels deep to retrieve. depth=1 = immediate children only. depth=2+ = recursive tree."),
```

Modify handler to do recursive fetch when `depth > 1`:
```typescript
async function getChildrenRecursive(
  accessToken: string, instanceUrl: string,
  pageId: string, currentDepth: number, maxDepth: number
): Promise<unknown[]> {
  const res = await confluenceRequest(accessToken, instanceUrl,
    `/rest/api/content/${pageId}/child/page?limit=25&expand=title,version,space`);
  const data = await res.json<{ results: Array<{ id: string; title: string; version: { number: number } }> }>();
  if (currentDepth >= maxDepth || !data.results.length) return data.results;
  return Promise.all(data.results.map(async child => ({
    ...child,
    children: await getChildrenRecursive(accessToken, instanceUrl, child.id, currentDepth + 1, maxDepth),
  })));
}
```

In handler:
```typescript
const tree = await getChildrenRecursive(accessToken, instanceUrl, p.page_id, 1, p.depth ?? 1);
return ok({ page_id: p.page_id, children: tree });
```

### 4.8 CONFLUENCE: New Tools

#### `confluence_get_space_activity`

```typescript
const ConfluenceSpaceActivityInput = z.object({
  space_key: z.string(),
  start_date: z.string().optional().describe("ISO date string, e.g. 2025-01-01"),
  end_date: z.string().optional().describe("ISO date string"),
  limit: z.number().int().min(1).max(50).default(25).optional(),
});

server.registerTool("confluence_get_space_activity", {
  description: "Get recently modified pages in a Confluence space with author info. " +
    "Use for team contribution reporting and document health monitoring. " +
    "Optionally filter by date range.",
  inputSchema: ConfluenceSpaceActivityInput,
}, async (p) => {
  const { accessToken, instanceUrl } = await getCreds();
  try {
    let cql = `space="${p.space_key}" AND type=page`;
    if (p.start_date) cql += ` AND lastModified >= "${p.start_date}"`;
    if (p.end_date) cql += ` AND lastModified <= "${p.end_date}"`;
    cql += " ORDER BY lastModified DESC";

    const res = await confluenceRequest(accessToken, instanceUrl,
      `/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=${p.limit ?? 25}&expand=history.lastUpdated,history.createdBy,version`);
    const data = await res.json<{ results: unknown[]; totalSize: number }>();
    return ok({ space_key: p.space_key, total: data.totalSize, pages: data.results });
  } catch (e) { return err(e); }
});
```

---

## 5. PHASE 1 — COMPLETE TOOL COUNT VERIFICATION

After all changes, run this count check:
```bash
grep -c 'server.registerTool(' cloudflare-worker-multi/src/tools/jira.ts
grep -c 'server.registerTool(' cloudflare-worker-multi/src/tools/confluence.ts
```

**Expected:**
- Jira: 15 tools (18 − 3 removed − 4 merged into 2 + 3 new = 14; check exact count)
  - Keep: jira_search, jira_get_issue, jira_create_issue, jira_update_issue, jira_add_comment, jira_get_projects, jira_search_users, jira_get_sprint_issues, jira_get_epic_issues (9 kept)
  - New merged: jira_transition, jira_list_sprints, jira_sprint_analytics (3 merged from 6)
  - New: jira_bulk_create_issues, jira_get_backlog, jira_get_sprint_worklogs (3 new)
  - Total: 9 + 3 + 3 = **15**

- Confluence: 22 tools (30 − 4 removed − 8 merged into 4 + 1 new = 23; check exact count)
  - Removed: confluence_get_page_analytics, confluence_get_space_permissions, confluence_get_attachments, confluence_upload_attachment (4)
  - Merged (8→4): confluence_comments, confluence_labels, confluence_history, confluence_restrictions (4 from 8)
  - Keep: confluence_search, confluence_get_page, confluence_get_page_by_title, confluence_create_page, confluence_update_page, confluence_delete_page, confluence_move_page, confluence_copy_page, confluence_get_spaces, confluence_get_space_pages, confluence_get_page_children (upgraded), confluence_search_users, confluence_get_macro_configs, confluence_get_drawio_diagram, confluence_update_drawio_diagram, confluence_get_content_properties, confluence_set_content_property (17)
  - New: confluence_get_space_activity (1)
  - Total: 4 + 17 + 1 = **22**

- **Grand total: 15 + 22 = 37 tools (under 48 limit ✅)**

---

## 6. PHASE 1 — TEST CHECKLIST (TC-PHASE1)

Run each test via Claude.ai after deploying. For each test, call the tool with the specified params and verify expected behavior.

### Jira — Changed/New Tools

| TC | Tool | Params | Expected |
|---|---|---|---|
| TC-J01 | `jira_transition` | `{issue_key: "TEST-xxx"}` (no transition_id) | Returns array of `{id, name, to}` |
| TC-J02 | `jira_transition` | `{issue_key: "TEST-xxx", transition_id: "id_from_TC-J01"}` | "Issue TEST-xxx transitioned successfully." |
| TC-J03 | `jira_list_sprints` | `{project_key: "KEY"}` | Returns `{board_id, sprints: [...]}` |
| TC-J04 | `jira_list_sprints` | `{project_key: "KEY", state: "closed", max_results: 3}` | Returns closed sprints |
| TC-J05 | `jira_sprint_analytics` | `{board_id: "X", sprint_id: "Y", type: "report"}` | Returns sprint report |
| TC-J06 | `jira_sprint_analytics` | `{board_id: "X", type: "velocity"}` | Returns velocity data |
| TC-J07 | `jira_search` | `{jql: "project=KEY ORDER BY updated DESC", max_results: 3, include_changelog: true}` | Issues have `changelog` field |
| TC-J08 | `jira_search` | `{jql: "project=KEY", max_results: 3}` (no include_changelog) | Issues without `changelog` field |
| TC-J09 | `jira_bulk_create_issues` | `{issues: [{project_key: "TEST", summary: "Bulk test 1", issue_type: "Task"}, {project_key: "TEST", summary: "Bulk test 2", issue_type: "Task"}]}` | Returns `{created: ["TEST-xxx", "TEST-yyy"]}` |
| TC-J10 | `jira_get_backlog` | `{project_key: "KEY"}` | Returns issues with `sprint is EMPTY` |
| TC-J11 | `jira_get_sprint_worklogs` | `{sprint_id: <active_sprint_id>}` | Returns `{users: [...], total_issues_with_worklogs: N}` |
| TC-J12 | Cleanup | Delete TEST issues from TC-J09 | Done |

**Removed tools — verify they no longer exist:**
- `jira_list_dashboards` → should return "Tool not found" error
- `jira_get_issue_types` → should return "Tool not found" error
- `jira_get_worklogs` → should return "Tool not found" error

### Confluence — Changed/New Tools

| TC | Tool | Params | Expected |
|---|---|---|---|
| TC-C01 | `confluence_comments` | `{page_id: "47186671", action: "get"}` | Returns `{comments: [...]}` |
| TC-C02 | Create temp page first, then: `confluence_comments` | `{page_id: "<new_id>", action: "add", comment: "Test comment"}` | Comment added |
| TC-C03 | `confluence_labels` | `{page_id: "47186671", action: "get"}` | Returns label array |
| TC-C04 | `confluence_labels` | `{page_id: "<new_id>", action: "add", labels: ["mcp-test"]}` | Label added |
| TC-C05 | `confluence_labels` | `{page_id: "<new_id>", action: "remove", labels: ["mcp-test"]}` | Label removed |
| TC-C06 | `confluence_history` | `{page_id: "47186671", detail: "summary"}` | Returns created_by, created_date |
| TC-C07 | `confluence_history` | `{page_id: "47186671", detail: "versions", limit: 3}` | Returns version list |
| TC-C08 | `confluence_restrictions` | `{page_id: "<new_id>"}` | Returns current restrictions |
| TC-C09 | `confluence_restrictions` | `{page_id: "<new_id>", restrictions: [{operation: "read", users: ["tuongpm"]}]}` | Restriction set |
| TC-C10 | `confluence_restrictions` | `{page_id: "<new_id>", restrictions: []}` | "All restrictions removed." |
| TC-C11 | `confluence_get_page_children` | `{page_id: "47186671", depth: 1}` | Returns immediate children (same as before) |
| TC-C12 | `confluence_get_page_children` | `{page_id: "2097240", depth: 2}` | Returns children with nested children |
| TC-C13 | `confluence_get_space_activity` | `{space_key: "PT"}` | Returns recently modified pages with author |
| TC-C14 | `confluence_get_space_activity` | `{space_key: "PT", start_date: "2026-01-01", limit: 5}` | Filtered by date |
| TC-C15 | Cleanup temp page | `confluence_delete_page` | Done |

**Removed tools — verify they no longer exist:**
- `confluence_get_page_analytics` → "Tool not found"
- `confluence_get_space_permissions` → "Tool not found"
- `confluence_get_attachments` → "Tool not found"
- `confluence_upload_attachment` → "Tool not found"

---

## 7. PHASE 2 — MONOREPO RESTRUCTURE

### 7.1 Target Directory Structure

```
mcp-atlassian-dc/
  cloudflare-worker-multi/     ← UNCHANGED (keep as regression baseline)
    src/ ...
    wrangler.jsonc

  shared/                      ← NEW: copy from cloudflare-worker-multi/src/
    oauth.ts
    jwt.ts
    crypto.ts
    atlassian.ts
    mcp-agent.ts               ← WITH MODIFICATION (see 7.4)
    types.ts

  tools/                       ← NEW: the optimized tools from Phase 1
    jira.ts                    ← copy cloudflare-worker-multi/src/tools/jira.ts
    confluence.ts              ← copy cloudflare-worker-multi/src/tools/confluence.ts

  cloudflare-worker-jira/      ← POPULATE
    src/
      index.ts                 ← NEW (see 7.5)
    wrangler.jsonc             ← NEW (see 7.6)
    package.json               ← copy from cloudflare-worker-multi/
    tsconfig.json              ← NEW (see 7.7)

  cloudflare-worker-confluence/ ← POPULATE
    src/
      index.ts                 ← NEW (see 7.5)
    wrangler.jsonc             ← NEW (see 7.6)
    package.json               ← copy from cloudflare-worker-multi/
    tsconfig.json              ← NEW (see 7.7)
```

### 7.2 Shared Files — Copy Without Modification

Copy the following files exactly from `cloudflare-worker-multi/src/` to `shared/`:
- `oauth.ts`
- `jwt.ts`
- `crypto.ts`
- `atlassian.ts`
- `types.ts`

Copy `cloudflare-worker-multi/src/tools/jira.ts` to `tools/jira.ts`.
Copy `cloudflare-worker-multi/src/tools/confluence.ts` to `tools/confluence.ts`.

**Important:** These copies are made AFTER Phase 1 changes are deployed, so they contain the updated tool set.

### 7.3 Shared mcp-agent.ts — ONE Modification Required

Copy `cloudflare-worker-multi/src/mcp-agent.ts` to `shared/mcp-agent.ts`, then apply this change:

**Current** in `unauthorizedResponse`:
```typescript
const base = `${baseUrl}/${svc}`;
const wwwParts = [
  `Bearer realm="${base}"`,
  `resource_metadata_url="${base}/.well-known/oauth-protected-resource"`,
];
```

**Change to** (split workers have no slug in URL):
```typescript
// For split workers: baseUrl IS the service root (no slug).
// For backward compat with multi-worker: svc param is kept but not used in URL.
const base = baseUrl;
const wwwParts = [
  `Bearer realm="${base}"`,
  `resource_metadata_url="${base}/.well-known/oauth-protected-resource"`,
];
```

Also update imports in `shared/mcp-agent.ts` to reference `./tools/jira` and `./tools/confluence`:
```typescript
// Change these two import lines:
import { registerJiraTools } from "../tools/jira";
import { registerConfluenceTools } from "../tools/confluence";
```

And all other imports: `./types` → `./types`, `./jwt` → `./jwt`, etc. (they stay relative to `shared/`).

### 7.4 Tools File Imports Update

In `tools/jira.ts` and `tools/confluence.ts`, change the import path for types and atlassian:
```typescript
// jira.ts / confluence.ts — change relative import paths:
import { ... } from "../shared/types";         // was "./types"  (but adjust based on actual imports)
import { jiraRequest } from "../shared/atlassian";  // was "./atlassian" etc.
```

Check actual imports in each tool file and update to reflect the new `../shared/` path.

### 7.5 Worker-Specific `index.ts`

**`cloudflare-worker-jira/src/index.ts`:**

```typescript
import { Hono } from "hono";
import { Env } from "../../shared/types";
import {
  buildOAuthMetadata, buildResourceMetadata,
  handleAuthorize, handleCallback, handleToken, CALLBACK_PATH,
} from "../../shared/oauth";
import { handleMcpRequest } from "../../shared/mcp-agent";
import { verifyJWT } from "../../shared/jwt";

/**
 * Jira-only MCP Worker — jira.tuongbeo.workers.dev
 * MCP URL: https://jira.tuongbeo.workers.dev/mcp
 * Separate domain from confluence worker = independent Claude.ai tool budget.
 */
const SVC = "jira" as const;
const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({
  status: "ok", service: "jira", version: "2.0.0",
  mcp: `${c.env.PUBLIC_BASE_URL}/mcp`,
  timestamp: new Date().toISOString(),
}));

app.get("/.well-known/oauth-protected-resource/mcp", (c) =>
  c.json(buildResourceMetadata(c.env.PUBLIC_BASE_URL, "/mcp")));

app.get("/.well-known/oauth-protected-resource", (c) =>
  c.json(buildResourceMetadata(c.env.PUBLIC_BASE_URL, "/mcp")));

app.get("/.well-known/oauth-authorization-server", (c) =>
  c.json(buildOAuthMetadata(c.env.PUBLIC_BASE_URL, c.env.PUBLIC_BASE_URL)));

app.get("/authorize", async (c) => handleAuthorize(c.req.raw, c.env, SVC));
app.post("/token", async (c) => handleToken(c.req.raw, c.env));
app.get(CALLBACK_PATH, async (c) => handleCallback(c.req.raw, c.env));

app.post("/register", async (c) => {
  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch { /* ok */ }
  return c.json({
    client_id: (body.client_id as string) ?? crypto.randomUUID(),
    client_secret: (body.client_secret as string) ?? crypto.randomUUID(),
    redirect_uris: body.redirect_uris ?? [],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
  }, 201);
});

app.all("/mcp", async (c) => {
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const base = c.env.PUBLIC_BASE_URL;
  if (!token) return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": [
        `Bearer realm="${base}"`,
        `resource_metadata_url="${base}/.well-known/oauth-protected-resource"`,
      ].join(", "),
    },
  });
  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) return new Response(
    JSON.stringify({ error: "invalid_token", error_description: "Token invalid or expired." }),
    { status: 401, headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer realm="${base}", error="invalid_token", resource_metadata_url="${base}/.well-known/oauth-protected-resource"`,
    }},
  );
  return handleMcpRequest(c.req.raw, c.env, SVC);
});

app.notFound((c) => c.json({ error: "not_found" }, 404));
export default app;
```

**`cloudflare-worker-confluence/src/index.ts`:**

Identical to Jira index.ts except:
```typescript
const SVC = "confluence" as const;
// health: service: "confluence"
// health: mcp: confluence MCP URL
```

### 7.6 Worker `wrangler.jsonc`

**`cloudflare-worker-jira/wrangler.jsonc`:**
```jsonc
{
  "name": "jira",
  "main": "src/index.ts",
  "compatibility_date": "2025-09-15",
  "compatibility_flags": ["nodejs_compat"],
  "kv_namespaces": [
    {
      "binding": "OAUTH_KV",
      "id": "af2e3b157a1b47f7883652ef93c6e69a"
    }
  ]
}
```
Note: `PUBLIC_BASE_URL` and `JWT_SECRET` are set as secrets in Cloudflare dashboard (not in wrangler.jsonc).
After deployment, set via: `npx wrangler secret put PUBLIC_BASE_URL` (value: `https://jira.tuongbeo.workers.dev`)

**`cloudflare-worker-confluence/wrangler.jsonc`:**
```jsonc
{
  "name": "confluence",
  "main": "src/index.ts",
  "compatibility_date": "2025-09-15",
  "compatibility_flags": ["nodejs_compat"],
  "kv_namespaces": [
    {
      "binding": "OAUTH_KV",
      "id": "af2e3b157a1b47f7883652ef93c6e69a"
    }
  ]
}
```
After deployment: `npx wrangler secret put PUBLIC_BASE_URL` (value: `https://confluence.tuongbeo.workers.dev`)

### 7.7 Worker `tsconfig.json`

Both workers use the same tsconfig that allows cross-directory imports:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/**/*", "../../shared/**/*", "../../tools/**/*"]
}
```

### 7.8 Phase 2 Validation — Dry Run Only (NO DEPLOY)

After creating all files:

```bash
# Validate Jira worker compiles
cd /Users/tuongbeo/Development/mcp-atlassian-dc/cloudflare-worker-jira
npm install
npx wrangler deploy --dry-run 2>&1 | tail -5
# Expected: "--dry-run: exiting now."

# Validate Confluence worker compiles
cd /Users/tuongbeo/Development/mcp-atlassian-dc/cloudflare-worker-confluence
npm install
npx wrangler deploy --dry-run 2>&1 | tail -5
# Expected: "--dry-run: exiting now."
```

Both must pass with 0 TypeScript errors before committing.

---

## 8. COMMIT MESSAGES

```bash
# After Phase 1:
git add cloudflare-worker-multi/src/tools/
git commit -m "feat(tools): optimize tool set v2

Jira (18 → 15):
- Remove: jira_list_dashboards, jira_get_issue_types, jira_get_worklogs
- Merge: jira_transition (from get_transitions+transition_issue)
- Merge: jira_list_sprints (from get_agile_boards+get_sprints)
- Merge: jira_sprint_analytics (from get_sprint_report+get_sprint_velocity)
- Upgrade: jira_search (add include_changelog param)
- New: jira_bulk_create_issues, jira_get_backlog, jira_get_sprint_worklogs

Confluence (30 → 22):
- Remove: get_page_analytics, get_space_permissions, get_attachments, upload_attachment
- Merge: confluence_comments (from add_comment+get_page_comments)
- Merge: confluence_labels (from get_labels+add_label+remove_label)
- Merge: confluence_history (from get_page_history+get_page_versions)
- Merge: confluence_restrictions (from get_page_restrictions+set_page_restrictions)
- Upgrade: confluence_get_page_children (add depth param for recursive tree)
- New: confluence_get_space_activity

Total: 37 tools (was 48), under Claude.ai injection limit"

# After Phase 2:
git add shared/ tools/ cloudflare-worker-jira/ cloudflare-worker-confluence/
git commit -m "feat(repo): monorepo structure for future split-worker deployment

Add shared/ and tools/ directories as common source for jira + confluence workers.
Populate cloudflare-worker-jira/ and cloudflare-worker-confluence/ with:
- worker-specific index.ts (no /jira /confluence slug in routes)
- wrangler.jsonc (name: jira / name: confluence)
- same KV namespace af2e3b157a1b47f7883652ef93c6e69a

Both workers validated with --dry-run. NOT deployed.
Current atlassian.tuongbeo.workers.dev unaffected.
Phase 3 (split deployment) requires explicit confirmation + Atlassian App Link update."
```

---

## 9. WHAT NOT TO DO

- DO NOT deploy `cloudflare-worker-jira` or `cloudflare-worker-confluence` — dry-run only
- DO NOT modify `cloudflare-worker-multi/src/oauth.ts` or any shared auth code
- DO NOT change the `sub` derivation formula
- DO NOT remove or rename the `atlassian.tuongbeo.workers.dev` connector in Claude.ai
- DO NOT touch `index.ts` in `cloudflare-worker-multi/src/` during Phase 1
- DO NOT add Cloudflare secrets for new workers until Phase 3 confirmation
- Stop and report after completing Phase 2 dry-run validation. Wait for explicit "proceed to Phase 3" instruction.
