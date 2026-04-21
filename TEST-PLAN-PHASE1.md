# Test Plan — Phase 1 Tool Optimization
# MCP Atlassian DC: v2.0.0 (37 tools: 15 Jira + 22 Confluence)

**Version:** Phase 1 — deployed `atlassian.tuongbeo.workers.dev` v5da435a4  
**QA Role:** Senior QA Review before Phase 3 split-worker deployment  
**Date:** 2026-04-21

---

## 1. SCOPE

Phase 1 changed the tool set from 48 to 37 tools. This test plan covers:

| Category | Count | Risk |
|---|---|---|
| Removed tools — must return error | 9 Jira + 8 Confluence = 17 | HIGH: old callers break |
| Merged tools — new API contract | 3 Jira + 4 Confluence = 7 | HIGH: behavior change |
| Upgraded tools — new params | 1 Jira + 1 Confluence = 2 | MEDIUM: backward compat |
| New tools — fresh implementation | 3 Jira + 1 Confluence = 4 | MEDIUM: untested in prod |
| Unchanged tools — regression | 8 Jira + 11 Confluence = 19 | LOW: no code change |

---

## 2. STATIC ANALYSIS FINDINGS

### 2.1 CONFIRMED BUGS (regression-test.sh v1)

The existing regression-test.sh tests **8 tools that no longer exist**. Running it against
the deployed v2 worker will produce false FAILs:

| Test ID | Tool | Status in v2 |
|---|---|---|
| TC-05-05 | `jira_get_issue_types` | REMOVED → MCP returns tool-not-found |
| TC-05-06 | `jira_get_agile_boards` | REMOVED → MCP returns tool-not-found |
| TC-05-07 | `jira_get_sprints` | REMOVED → MCP returns tool-not-found |
| TC-05-11 | `jira_get_sprint_velocity` | REMOVED → MCP returns tool-not-found |
| TC-07-08 | `confluence_get_page_analytics` | REMOVED → MCP returns tool-not-found |
| TC-08-03 | `confluence_add_label` | REMOVED → MCP returns tool-not-found |
| TC-08-06 | `confluence_get_page_comments` | REMOVED → MCP returns tool-not-found |
| TC-09-07 | `confluence_get_space_permissions` | REMOVED → MCP returns tool-not-found |

**Action:** Regression-test.sh must be updated before running. See Section 5.

### 2.2 BEHAVIORAL CHANGES (need live verification)

| Tool | Change | Risk |
|---|---|---|
| `jira_search` | Now always appends `&expand=renderedFields,names` (or `...changelog`). v1 had NO expand param. | Response payload is larger. Should not break but adds latency. |
| `confluence_restrictions` (SET) | Body format: was `[array]` via old tool with `usernames` field → new tool uses `[array]` too but field name changed from `usernames`/`group_names` to `users`/`groups`. Input schema changed. | Only affects callers using the old schema. |
| `confluence_comments` (add) | Uses `/content/{id}/child/comment` POST instead of `/content` POST with `container`. Both are valid Confluence DC endpoints. | Should work identically. |

### 2.3 POTENTIAL RUNTIME ISSUES

| Issue | Location | Severity |
|---|---|---|
| `jira_list_sprints` only queries `type=scrum` boards | `jira.ts:215` | LOW — Kanban projects return "No Scrum board found" error |
| `confluence_get_space_activity` uses CQL `lastModified` field | `confluence.ts` | LOW — verify CQL field name is correct on this DC instance |
| `jira_get_sprint_worklogs` max 50 issues — silent truncation | `jira.ts` | INFO — by design but undocumented in tool description |

---

## 3. TEST MATRIX

### 3.1 JIRA — Removed Tools (must return error/unknown tool)

| TC | Tool | Expected |
|---|---|---|
| TC-R-J01 | `jira_list_dashboards` | isError: true OR unknown tool |
| TC-R-J02 | `jira_get_issue_types` | isError: true OR unknown tool |
| TC-R-J03 | `jira_get_worklogs` | isError: true OR unknown tool |
| TC-R-J04 | `jira_get_transitions` | isError: true OR unknown tool |
| TC-R-J05 | `jira_transition_issue` | isError: true OR unknown tool |
| TC-R-J06 | `jira_get_agile_boards` | isError: true OR unknown tool |
| TC-R-J07 | `jira_get_sprints` | isError: true OR unknown tool |
| TC-R-J08 | `jira_get_sprint_report` | isError: true OR unknown tool |
| TC-R-J09 | `jira_get_sprint_velocity` | isError: true OR unknown tool |

### 3.2 JIRA — Merged Tools (new API)

| TC | Tool | Params | Expected |
|---|---|---|---|
| TC-M-J01 | `jira_transition` | `{issue_key:"TEST-1"}` (no transition_id) | Array of `{id, name, to}` |
| TC-M-J02 | `jira_transition` | `{issue_key:"TEST-1", transition_id:"<id>"}` | "transitioned successfully" |
| TC-M-J03 | `jira_transition` | `{issue_key:"TEST-1", transition_id:"<id>", comment:"QA test"}` | Transition + comment added |
| TC-M-J04 | `jira_list_sprints` | `{project_key:"KEY"}` | `{board_id: N, sprints:[...]}` |
| TC-M-J05 | `jira_list_sprints` | `{project_key:"KEY", state:"closed", max_results:3}` | Closed sprints |
| TC-M-J06 | `jira_list_sprints` | `{board_id:18}` | Sprints without board lookup |
| TC-M-J07 | `jira_list_sprints` | `{}` (no params) | Error: "Provide either project_key or board_id" |
| TC-M-J08 | `jira_sprint_analytics` | `{board_id:"18", sprint_id:"X", type:"report"}` | Sprint report object |
| TC-M-J09 | `jira_sprint_analytics` | `{board_id:"18", type:"velocity"}` | `{sprints, rolling_3sprint_avg, trend}` |
| TC-M-J10 | `jira_sprint_analytics` | `{board_id:"18", sprint_id:"X", type:"both"}` | `{report:{...}, velocity:{...}}` |
| TC-M-J11 | `jira_sprint_analytics` | `{board_id:"18", type:"report"}` (no sprint_id) | Error: "sprint_id required" |

### 3.3 JIRA — Upgraded Tool

| TC | Tool | Params | Expected |
|---|---|---|---|
| TC-U-J01 | `jira_search` | `{jql:"project=KEY", max_results:2}` (no changelog) | Issues WITHOUT `changelog` key |
| TC-U-J02 | `jira_search` | `{jql:"project=KEY", max_results:2, include_changelog:true}` | Issues WITH `changelog.histories` array |
| TC-U-J03 | `jira_search` | `{jql:"project=KEY", max_results:2, include_changelog:false}` | Backward compat — same as TC-U-J01 |

### 3.4 JIRA — New Tools

| TC | Tool | Params | Expected |
|---|---|---|---|
| TC-N-J01 | `jira_get_backlog` | `{project_key:"KEY"}` | `{total:N, issues:[...]}` where sprint is EMPTY |
| TC-N-J02 | `jira_get_backlog` | `{project_key:"KEY", max_results:5}` | Max 5 issues |
| TC-N-J03 | `jira_get_sprint_worklogs` | `{sprint_id:<active>}` | `{sprint_id, users:[...], total_issues_with_worklogs:N}` |
| TC-N-J04 | `jira_get_sprint_worklogs` | `{sprint_id:999999}` | Error or `{users:[]}` |
| TC-N-J05 | `jira_bulk_create_issues` | 2 Task items in TEST project | `{created:["TEST-X","TEST-Y"], errors:[]}` |
| TC-N-J06 | `jira_bulk_create_issues` (cleanup) | Delete TC-N-J05 issues | Done |

### 3.5 CONFLUENCE — Removed Tools

| TC | Tool | Expected |
|---|---|---|
| TC-R-C01 | `confluence_get_page_analytics` | isError: true OR unknown tool |
| TC-R-C02 | `confluence_get_space_permissions` | isError: true OR unknown tool |
| TC-R-C03 | `confluence_get_attachments` | isError: true OR unknown tool |
| TC-R-C04 | `confluence_upload_attachment` | isError: true OR unknown tool |
| TC-R-C05 | `confluence_add_comment` | isError: true OR unknown tool |
| TC-R-C06 | `confluence_get_page_comments` | isError: true OR unknown tool |
| TC-R-C07 | `confluence_get_labels` | isError: true OR unknown tool |
| TC-R-C08 | `confluence_add_label` | isError: true OR unknown tool |
| TC-R-C09 | `confluence_remove_label` | isError: true OR unknown tool |
| TC-R-C10 | `confluence_get_page_history` (old name) | isError: true OR unknown tool — NOTE: new tool is `confluence_history` |
| TC-R-C11 | `confluence_get_page_versions` | isError: true OR unknown tool |
| TC-R-C12 | `confluence_get_page_restrictions` | isError: true OR unknown tool |
| TC-R-C13 | `confluence_set_page_restrictions` | isError: true OR unknown tool |

### 3.6 CONFLUENCE — Merged Tools

| TC | Tool | Params | Expected |
|---|---|---|---|
| TC-M-C01 | `confluence_comments` | `{page_id:"47186671", action:"get"}` | `{comments:[...]}` |
| TC-M-C02 | `confluence_comments` | `{page_id:"<new>", action:"add", comment:"QA test"}` | `{id:"..."}` |
| TC-M-C03 | `confluence_comments` | `{page_id:"<new>", action:"add"}` (no comment) | Error: "comment is required" |
| TC-M-C04 | `confluence_labels` | `{page_id:"47186671", action:"get"}` | Labels array |
| TC-M-C05 | `confluence_labels` | `{page_id:"<new>", action:"add", labels:["qa-test"]}` | Label added |
| TC-M-C06 | `confluence_labels` | `{page_id:"<new>", action:"remove", labels:["qa-test"]}` | `["Removed label: qa-test"]` |
| TC-M-C07 | `confluence_labels` | `{page_id:"<new>", action:"add"}` (no labels) | Error: "labels array required" |
| TC-M-C08 | `confluence_history` | `{page_id:"47186671", detail:"summary"}` | `{created_by, created_date, last_updated_by}` |
| TC-M-C09 | `confluence_history` | `{page_id:"47186671", detail:"versions", limit:3}` | `{total:N, versions:[...]}` |
| TC-M-C10 | `confluence_restrictions` | `{page_id:"<new>"}` (no restrictions) | Current restrictions object |
| TC-M-C11 | `confluence_restrictions` | `{page_id:"<new>", restrictions:[{operation:"read",users:["tuongpm"]}]}` | "Restrictions set" |
| TC-M-C12 | `confluence_restrictions` | `{page_id:"<new>", restrictions:[]}` | "All restrictions removed." |

### 3.7 CONFLUENCE — Upgraded Tool

| TC | Tool | Params | Expected |
|---|---|---|---|
| TC-U-C01 | `confluence_get_page_children` | `{page_id:"47186671", depth:1}` | Flat children (backward compat) |
| TC-U-C02 | `confluence_get_page_children` | `{page_id:"2097240", depth:2}` | Children with `children:[]` nested |
| TC-U-C03 | `confluence_get_page_children` | `{page_id:"2097240", depth:3}` | 3-level tree |

### 3.8 CONFLUENCE — New Tool

| TC | Tool | Params | Expected |
|---|---|---|---|
| TC-N-C01 | `confluence_get_space_activity` | `{space_key:"PT"}` | `{space_key:"PT", total:N, pages:[...]}` |
| TC-N-C02 | `confluence_get_space_activity` | `{space_key:"PT", start_date:"2026-01-01", limit:5}` | Filtered by date |
| TC-N-C03 | `confluence_get_space_activity` | `{space_key:"PT", start_date:"2099-01-01"}` | `{total:0, pages:[]}` or empty |

---

## 4. REGRESSION TESTS (existing tools, unchanged)

Run only a smoke-test subset. These tools had NO code changes.

### Jira
- `jira_get_projects` — returns project list with `key`
- `jira_get_issue` — returns issue detail with `changelog`
- `jira_create_issue` / `jira_update_issue` — CRUD round-trip (TEST project)
- `jira_add_comment` — comment appears on issue
- `jira_search_users` — returns tuongpm
- `jira_get_sprint_issues` — returns issues for active sprint
- `jira_get_epic_issues` — returns child issues

### Confluence
- `confluence_search` — CQL search returns results
- `confluence_get_page` — page 47186671 returns body
- `confluence_get_page_by_title` — exact title match
- `confluence_create_page` / `confluence_update_page` / `confluence_delete_page` — lifecycle
- `confluence_get_spaces` — returns PT space
- `confluence_get_space_pages` — PT space pages
- `confluence_get_macro_configs` — BUG-07 regression (page 52888152)
- `confluence_get_drawio_diagram` — BUG-07 regression
- `confluence_get_content_properties` — returns properties
- `confluence_search_users` — finds tuongpm
- `confluence_move_page` / `confluence_copy_page` — structural ops

---

## 5. PASS/FAIL CRITERIA

**PASS condition for deployment:**
- All TC-R-* (removed tools): return error/unknown (not success)
- All TC-M-* (merged tools): both sub-behaviors work correctly
- All TC-U-* (upgraded tools): new param works AND old behavior preserved
- All TC-N-* (new tools): return valid data
- Regression: 0 new failures vs v1 baseline
- Total: 0 FAIL, warnings < 3

**FAIL condition (block deployment):**
- Any removed tool returns success (ghost tool)
- Any merged tool missing one behavior mode
- `jira_search` with `include_changelog:true` returns issues WITHOUT `changelog`
- Any new tool returns 500 server error
- Regression failure on core tools (jira_search, confluence_get_page, etc.)

---

## 6. TEST EXECUTION

Run the updated regression-test.sh:

```bash
WORKER_TOKEN=<your-jwt> ./regression-test.sh
```

Getting WORKER_TOKEN:
1. Open Claude.ai → any Jira or Confluence tool call
2. DevTools → Network → POST to /jira/mcp or /confluence/mcp
3. Copy Bearer token from Authorization header

Expected result: ALL PASS with 0 FAIL.
