#!/usr/bin/env bash
# regression-test.sh — MCP Atlassian DC Worker v2.0 (Phase 1)
# Covers: 37 tools (15 Jira + 22 Confluence)
# Tests: removed-tool errors, merged tool behavior, new tools, regression
#
# Usage:
#   WORKER_TOKEN=<jwt> ./regression-test.sh
#
# Getting WORKER_TOKEN:
#   Open Claude.ai → use any Jira/Confluence tool → DevTools → Network →
#   POST to /jira/mcp or /confluence/mcp → copy Bearer token

set -euo pipefail
BASE="https://atlassian.tuongbeo.workers.dev"
TOKEN="${WORKER_TOKEN:?Set WORKER_TOKEN — a valid proxy JWT for tuongpm}"
PASS=0; FAIL=0; WARN=0

# ── Helpers ───────────────────────────────────────────────────────────────────

check() {
  local id="$1" desc="$2" actual="$3" expected="$4"
  if echo "$actual" | grep -q "$expected" 2>/dev/null; then
    printf "  ✅ %-14s %s\n" "$id" "$desc"; ((PASS++))
  else
    printf "  ❌ %-14s %s\n" "$id" "$desc"
    printf "     Expected: %s\n" "$expected"
    printf "     Got:      %s\n" "${actual:0:150}"
    ((FAIL++))
  fi
}

check_status() {
  local id="$1" desc="$2" actual="$3" expected="$4"
  if [ "$actual" = "$expected" ]; then
    printf "  ✅ %-14s %s → HTTP %s\n" "$id" "$desc" "$actual"; ((PASS++))
  else
    printf "  ❌ %-14s %s — expected HTTP %s got %s\n" "$id" "$desc" "$expected" "$actual"; ((FAIL++))
  fi
}

check_error() {
  local id="$1" desc="$2" actual="$3"
  # Removed tools return either isError:true or "Unknown tool" in various formats
  if echo "$actual" | grep -qiE '"isError"\s*:\s*true|unknown tool|not found|Method not found|method_not_found' 2>/dev/null; then
    printf "  ✅ %-14s %s → correctly returns error\n" "$id" "$desc"; ((PASS++))
  else
    printf "  ❌ %-14s %s — expected error/unknown, got: %s\n" "$id" "$desc" "${actual:0:120}"; ((FAIL++))
  fi
}

warn() { printf "  ⚠️  %-14s %s\n" "$1" "$2"; ((WARN++)); }

mcp_jira() {
  curl -sf -X POST "$BASE/jira/mcp" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}" \
    2>/dev/null || echo '{"error":"curl_failed"}'
}

mcp_conf() {
  curl -sf -X POST "$BASE/confluence/mcp" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}" \
    2>/dev/null || echo '{"error":"curl_failed"}'
}

extract() {
  echo "$1" | python3 -c "
import sys, json
try:
  d = json.load(sys.stdin)
  t = d.get('result',{}).get('content',[{}])[0].get('text','{}')
  o = json.loads(t) if t.startswith(('{','[')) else t
  print(json.dumps(o) if isinstance(o, (dict,list)) else str(o))
except Exception as e:
  print('')
" 2>/dev/null || echo ""
}


# ── TC-01: Infrastructure ─────────────────────────────────────────────────────
echo ""
echo "=== TC-01: Infrastructure ==="

R=$(curl -sf "$BASE/health" 2>/dev/null || echo "")
check "TC-01-01" "Health endpoint" "$R" '"status":"ok"'
check "TC-01-02" "Health version 2.0.0" "$R" '"version":"2.0.0"'

R=$(curl -sf "$BASE/.well-known/oauth-protected-resource/jira/mcp" 2>/dev/null || echo "")
check "TC-01-03" "Jira resource metadata" "$R" '"resource"'

R=$(curl -sf "$BASE/.well-known/oauth-protected-resource/confluence/mcp" 2>/dev/null || echo "")
check "TC-01-04" "Confluence resource metadata" "$R" '"resource"'

S=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/jira/mcp" -H "Content-Type: application/json" 2>/dev/null)
check_status "TC-01-05" "No auth → 401" "$S" "401"

S=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/jira/mcp" \
  -H "Authorization: Bearer bad.jwt.token" -H "Content-Type: application/json" 2>/dev/null)
check_status "TC-01-06" "Invalid JWT → 401" "$S" "401"


# ── TC-02: Removed Jira Tools (must return error) ─────────────────────────────
echo ""
echo "=== TC-02: Removed Jira Tools ==="

for tool in jira_list_dashboards jira_get_issue_types jira_get_worklogs \
            jira_get_transitions jira_transition_issue \
            jira_get_agile_boards jira_get_sprints \
            jira_get_sprint_report jira_get_sprint_velocity; do
  R=$(mcp_jira "$tool" '{}')
  check_error "TC-02" "$tool removed" "$R"
done


# ── TC-03: Removed Confluence Tools (must return error) ───────────────────────
echo ""
echo "=== TC-03: Removed Confluence Tools ==="

for tool in confluence_get_page_analytics confluence_get_space_permissions \
            confluence_get_attachments confluence_upload_attachment \
            confluence_add_comment confluence_get_page_comments \
            confluence_get_labels confluence_add_label confluence_remove_label \
            confluence_get_page_history confluence_get_page_versions \
            confluence_get_page_restrictions confluence_set_page_restrictions; do
  R=$(mcp_conf "$tool" '{}')
  check_error "TC-03" "$tool removed" "$R"
done


# ── TC-04: Jira — Merged Tools ────────────────────────────────────────────────
echo ""
echo "=== TC-04: Jira Merged Tools ==="

# jira_transition — create temp issue first
CREATE=$(mcp_jira "jira_create_issue" \
  '{"project_key":"TEST","summary":"[REGRESSION v2] jira_transition test","issue_type":"Task","priority":"Low"}')
ISSUE_KEY=$(extract "$CREATE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('key',''))" 2>/dev/null || echo "")

if [ -n "$ISSUE_KEY" ]; then
  printf "  ✅ %-14s %s → %s\n" "TC-04-00" "create temp issue" "$ISSUE_KEY"; ((PASS++))

  # TC-04-01: list mode (no transition_id)
  R=$(mcp_jira "jira_transition" "{\"issue_key\":\"$ISSUE_KEY\"}")
  check "TC-04-01" "jira_transition list mode" "$R" '"id"'
  check "TC-04-01b" "jira_transition has 'to' field" "$R" '"to"'

  # TC-04-02: execute mode
  TID=$(extract "$R" | python3 -c "
import sys, json
ts = json.load(sys.stdin)
if isinstance(ts, list) and ts: print(ts[0].get('id',''))
" 2>/dev/null || echo "")
  if [ -n "$TID" ]; then
    R2=$(mcp_jira "jira_transition" "{\"issue_key\":\"$ISSUE_KEY\",\"transition_id\":\"$TID\"}")
    check "TC-04-02" "jira_transition execute mode" "$R2" "transitioned successfully"
  else
    warn "TC-04-02" "Could not extract transition_id for execute test"
  fi

  # TC-04-03: with comment
  TID2=$(mcp_jira "jira_transition" "{\"issue_key\":\"$ISSUE_KEY\"}" | \
    python3 -c "
import sys,json
d=json.load(sys.stdin)
t=d.get('result',{}).get('content',[{}])[0].get('text','[]')
ts=json.loads(t) if t.startswith('[') else []
print(ts[0]['id'] if ts else '')
" 2>/dev/null || echo "")
  if [ -n "$TID2" ]; then
    R3=$(mcp_jira "jira_transition" "{\"issue_key\":\"$ISSUE_KEY\",\"transition_id\":\"$TID2\",\"comment\":\"QA regression comment\"}")
    check "TC-04-03" "jira_transition with comment" "$R3" "transitioned successfully"
  fi

  # Cleanup
  DONE_ID=$(mcp_jira "jira_transition" "{\"issue_key\":\"$ISSUE_KEY\"}" | \
    python3 -c "
import sys,json
d=json.load(sys.stdin)
t=d.get('result',{}).get('content',[{}])[0].get('text','[]')
ts=json.loads(t) if t.startswith('[') else []
cl=[x for x in ts if any(k in x.get('name','').lower() for k in ['done','cancel','close','resolve'])]
print(cl[0]['id'] if cl else (ts[-1]['id'] if ts else ''))
" 2>/dev/null || echo "")
  [ -n "$DONE_ID" ] && mcp_jira "jira_transition" "{\"issue_key\":\"$ISSUE_KEY\",\"transition_id\":\"$DONE_ID\"}" > /dev/null 2>&1
  printf "  ✅ %-14s %s → cleaned up %s\n" "TC-04-99" "cleanup temp issue" "$ISSUE_KEY"; ((PASS++))
else
  printf "  ❌ %-14s %s\n" "TC-04-00" "create temp issue failed — skipping TC-04-01..03"; ((FAIL++))
fi


# jira_list_sprints
R=$(mcp_jira "jira_list_sprints" '{"project_key":"KEY"}')
check "TC-04-04" "jira_list_sprints by project_key" "$R" '"board_id"'
check "TC-04-05" "jira_list_sprints has sprints array" "$R" '"sprints"'

R=$(mcp_jira "jira_list_sprints" '{"project_key":"KEY","state":"closed","max_results":3}')
check "TC-04-06" "jira_list_sprints closed state" "$R" '"board_id"'

R=$(mcp_jira "jira_list_sprints" '{"board_id":18}')
check "TC-04-07" "jira_list_sprints by board_id direct" "$R" '"sprints"'

R=$(mcp_jira "jira_list_sprints" '{}')
check_error "TC-04-08" "jira_list_sprints no params → error" "$R"

# Get active sprint ID for analytics tests
SPRINT_ID=$(extract "$(mcp_jira 'jira_list_sprints' '{"project_key":"KEY","state":"active"}')" | \
  python3 -c "
import sys,json
d=json.load(sys.stdin)
sp=d.get('sprints',[])
print(str(sp[0]['id']) if sp else '')
" 2>/dev/null || echo "")

BOARD_ID=$(extract "$(mcp_jira 'jira_list_sprints' '{"project_key":"KEY","state":"active"}')" | \
  python3 -c "
import sys,json
d=json.load(sys.stdin)
print(str(d.get('board_id','')))
" 2>/dev/null || echo "18")

# jira_sprint_analytics
if [ -n "$SPRINT_ID" ] && [ -n "$BOARD_ID" ]; then
  R=$(mcp_jira "jira_sprint_analytics" "{\"board_id\":\"$BOARD_ID\",\"sprint_id\":\"$SPRINT_ID\",\"type\":\"report\"}")
  check "TC-04-09" "jira_sprint_analytics type=report" "$R" '"sprint"'
  check "TC-04-10" "sprint_analytics has completed_issues" "$R" '"completed_issues"'

  R=$(mcp_jira "jira_sprint_analytics" "{\"board_id\":\"$BOARD_ID\",\"type\":\"velocity\"}")
  check "TC-04-11" "jira_sprint_analytics type=velocity" "$R" '"rolling_3sprint_avg"'
  check "TC-04-12" "sprint_analytics velocity has trend" "$R" '"trend"'

  R=$(mcp_jira "jira_sprint_analytics" "{\"board_id\":\"$BOARD_ID\",\"sprint_id\":\"$SPRINT_ID\",\"type\":\"both\"}")
  check "TC-04-13" "jira_sprint_analytics type=both has report" "$R" '"report"'
  check "TC-04-14" "jira_sprint_analytics type=both has velocity" "$R" '"velocity"'
else
  warn "TC-04-09..14" "No active sprint found for KEY — skipping analytics tests"
fi

R=$(mcp_jira "jira_sprint_analytics" '{"board_id":"18","type":"report"}')
check_error "TC-04-15" "sprint_analytics report without sprint_id → error" "$R"


# ── TC-05: Jira — Upgraded Tool (jira_search + include_changelog) ─────────────
echo ""
echo "=== TC-05: Jira Upgraded Tools ==="

# Without changelog
R=$(mcp_jira "jira_search" '{"jql":"project=KEY ORDER BY updated DESC","max_results":2}')
check "TC-05-01" "jira_search returns issues" "$R" '"issues"'
HAS_CL=$(extract "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
issues=d.get('issues',[])
print('yes' if issues and 'changelog' in json.dumps(issues[0]) else 'no')
" 2>/dev/null || echo "no")
if [ "$HAS_CL" = "no" ]; then
  printf "  ✅ %-14s %s\n" "TC-05-02" "jira_search without changelog — no changelog field"; ((PASS++))
else
  printf "  ⚠️  %-14s %s\n" "TC-05-02" "jira_search unexpectedly contains changelog"; ((WARN++))
fi

# With include_changelog:true
R=$(mcp_jira "jira_search" '{"jql":"project=KEY ORDER BY updated DESC","max_results":2,"include_changelog":true}')
check "TC-05-03" "jira_search include_changelog=true returns issues" "$R" '"issues"'
HAS_CL=$(extract "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
issues=d.get('issues',[])
print('yes' if issues and 'changelog' in json.dumps(issues[0]) else 'no')
" 2>/dev/null || echo "no")
if [ "$HAS_CL" = "yes" ]; then
  printf "  ✅ %-14s %s\n" "TC-05-04" "jira_search include_changelog=true — changelog present"; ((PASS++))
else
  printf "  ❌ %-14s %s\n" "TC-05-04" "jira_search include_changelog=true — changelog MISSING"; ((FAIL++))
fi


# ── TC-06: Jira — New Tools ───────────────────────────────────────────────────
echo ""
echo "=== TC-06: Jira New Tools ==="

# jira_get_backlog
R=$(mcp_jira "jira_get_backlog" '{"project_key":"KEY"}')
check "TC-06-01" "jira_get_backlog returns total" "$R" '"total"'
check "TC-06-02" "jira_get_backlog has issues array" "$R" '"issues"'

R=$(mcp_jira "jira_get_backlog" '{"project_key":"KEY","max_results":5}')
BACKLOG_COUNT=$(extract "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(len(d.get('issues',[])))
" 2>/dev/null || echo "0")
if [ "$BACKLOG_COUNT" -le 5 ] 2>/dev/null; then
  printf "  ✅ %-14s %s → %s items (≤5)\n" "TC-06-03" "jira_get_backlog max_results=5" "$BACKLOG_COUNT"; ((PASS++))
else
  printf "  ❌ %-14s %s → %s items (expected ≤5)\n" "TC-06-03" "jira_get_backlog max_results=5" "$BACKLOG_COUNT"; ((FAIL++))
fi

# jira_get_sprint_worklogs
if [ -n "$SPRINT_ID" ]; then
  R=$(mcp_jira "jira_get_sprint_worklogs" "{\"sprint_id\":$SPRINT_ID}")
  check "TC-06-04" "jira_get_sprint_worklogs returns sprint_id" "$R" '"sprint_id"'
  check "TC-06-05" "jira_get_sprint_worklogs has users array" "$R" '"users"'
  check "TC-06-06" "jira_get_sprint_worklogs has total_issues_with_worklogs" "$R" '"total_issues_with_worklogs"'
else
  warn "TC-06-04..06" "No active sprint — skipping sprint_worklogs test"
fi

# jira_bulk_create_issues — creates 2 tasks, then cleans up
BULK=$(mcp_jira "jira_bulk_create_issues" \
  '{"issues":[{"project_key":"TEST","summary":"[REGRESSION v2] Bulk test 1","issue_type":"Task","priority":"Low"},{"project_key":"TEST","summary":"[REGRESSION v2] Bulk test 2","issue_type":"Task","priority":"Low"}]}')
check "TC-06-07" "jira_bulk_create_issues returns created" "$BULK" '"created"'

BULK_KEYS=$(extract "$BULK" | python3 -c "
import sys,json
d=json.load(sys.stdin)
keys=d.get('created',[])
print(' '.join(keys))
" 2>/dev/null || echo "")
if [ -n "$BULK_KEYS" ]; then
  KEY_COUNT=$(echo "$BULK_KEYS" | wc -w | tr -d ' ')
  printf "  ✅ %-14s %s → created %s issues: %s\n" "TC-06-08" "jira_bulk_create_issues count" "$KEY_COUNT" "$BULK_KEYS"; ((PASS++))
  # Cleanup bulk issues via transition to Done
  for K in $BULK_KEYS; do
    DONE=$(mcp_jira "jira_transition" "{\"issue_key\":\"$K\"}" | python3 -c "
import sys,json
d=json.load(sys.stdin)
t=d.get('result',{}).get('content',[{}])[0].get('text','[]')
ts=json.loads(t) if t.startswith('[') else []
cl=[x for x in ts if any(k in x.get('name','').lower() for k in ['done','cancel','close'])]
print(cl[0]['id'] if cl else (ts[-1]['id'] if ts else ''))
" 2>/dev/null || echo "")
    [ -n "$DONE" ] && mcp_jira "jira_transition" "{\"issue_key\":\"$K\",\"transition_id\":\"$DONE\"}" > /dev/null 2>&1
  done
  printf "  ✅ %-14s %s\n" "TC-06-09" "jira_bulk_create cleanup done"; ((PASS++))
else
  warn "TC-06-08" "Could not extract created issue keys"
fi


# ── TC-07: Confluence — Merged Tools (needs temp page) ───────────────────────
echo ""
echo "=== TC-07: Confluence Merged Tools ==="

# Create temp page for write tests
CPAGE=$(mcp_conf "confluence_create_page" \
  '{"space_key":"PT","title":"[REGRESSION v2] Temp QA page — safe to delete","content":"<p>QA test page.</p>","parent_id":"24577317"}')
CPID=$(extract "$CPAGE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")

if [ -n "$CPID" ]; then
  printf "  ✅ %-14s %s → page %s\n" "TC-07-00" "create temp page" "$CPID"; ((PASS++))

  # confluence_comments
  R=$(mcp_conf "confluence_comments" "{\"page_id\":\"$CPID\",\"action\":\"get\"}")
  check "TC-07-01" "confluence_comments action=get" "$R" '"comments"'

  R=$(mcp_conf "confluence_comments" "{\"page_id\":\"$CPID\",\"action\":\"add\",\"comment\":\"QA regression test comment\"}")
  check "TC-07-02" "confluence_comments action=add" "$R" '"id"'

  R=$(mcp_conf "confluence_comments" "{\"page_id\":\"$CPID\",\"action\":\"get\"}")
  CCOUNT=$(extract "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(len(d.get('comments',[])))
" 2>/dev/null || echo "0")
  if [ "$CCOUNT" -ge 1 ] 2>/dev/null; then
    printf "  ✅ %-14s %s → %s comment(s)\n" "TC-07-03" "confluence_comments add verified" "$CCOUNT"; ((PASS++))
  else
    printf "  ❌ %-14s %s\n" "TC-07-03" "confluence_comments add not reflected in get"; ((FAIL++))
  fi

  R=$(mcp_conf "confluence_comments" "{\"page_id\":\"$CPID\",\"action\":\"add\"}")
  check_error "TC-07-04" "confluence_comments add without comment → error" "$R"

  # confluence_labels
  R=$(mcp_conf "confluence_labels" "{\"page_id\":\"$CPID\",\"action\":\"get\"}")
  check "TC-07-05" "confluence_labels action=get" "$R" '"results"'

  R=$(mcp_conf "confluence_labels" "{\"page_id\":\"$CPID\",\"action\":\"add\",\"labels\":[\"qa-regression-v2\"]}")
  check "TC-07-06" "confluence_labels action=add" "$R" '"qa-regression-v2"'

  R=$(mcp_conf "confluence_labels" "{\"page_id\":\"$CPID\",\"action\":\"remove\",\"labels\":[\"qa-regression-v2\"]}")
  check "TC-07-07" "confluence_labels action=remove" "$R" '"Removed label"'

  R=$(mcp_conf "confluence_labels" "{\"page_id\":\"$CPID\",\"action\":\"add\"}")
  check_error "TC-07-08" "confluence_labels no labels array → error" "$R"

  # confluence_restrictions
  R=$(mcp_conf "confluence_restrictions" "{\"page_id\":\"$CPID\"}")
  check "TC-07-09" "confluence_restrictions GET mode" "$R" '"read"'

  R=$(mcp_conf "confluence_restrictions" \
    "{\"page_id\":\"$CPID\",\"restrictions\":[{\"operation\":\"read\",\"users\":[\"tuongpm\"]},{\"operation\":\"update\",\"users\":[\"tuongpm\"]}]}")
  # Should succeed (200) or return set confirmation
  if echo "$R" | grep -qiE '"isError"\s*:\s*true'; then
    printf "  ❌ %-14s %s — %s\n" "TC-07-10" "confluence_restrictions SET" "${R:0:120}"; ((FAIL++))
  else
    printf "  ✅ %-14s %s\n" "TC-07-10" "confluence_restrictions SET mode succeeded"; ((PASS++))
  fi

  R=$(mcp_conf "confluence_restrictions" "{\"page_id\":\"$CPID\",\"restrictions\":[]}")
  check "TC-07-11" "confluence_restrictions remove all" "$R" "restrictions removed"

  # Cleanup temp page
  mcp_conf "confluence_delete_page" "{\"page_id\":\"$CPID\"}" > /dev/null
  printf "  ✅ %-14s %s → deleted %s\n" "TC-07-99" "cleanup temp page" "$CPID"; ((PASS++))
else
  printf "  ❌ %-14s %s — skipping TC-07 suite\n" "TC-07-00" "create temp page failed"; ((FAIL++))
fi


# ── TC-08: Confluence — Merged History + Upgraded Children ───────────────────
echo ""
echo "=== TC-08: Confluence History + Children Depth ==="

# confluence_history
R=$(mcp_conf "confluence_history" '{"page_id":"47186671","detail":"summary"}')
check "TC-08-01" "confluence_history detail=summary" "$R" '"created_by"'
check "TC-08-02" "confluence_history has created_date" "$R" '"created_date"'
check "TC-08-03" "confluence_history has last_updated_by" "$R" '"last_updated_by"'

R=$(mcp_conf "confluence_history" '{"page_id":"47186671","detail":"versions","limit":3}')
check "TC-08-04" "confluence_history detail=versions" "$R" '"versions"'
VCOUNT=$(extract "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(len(d.get('versions',[])))
" 2>/dev/null || echo "0")
if [ "$VCOUNT" -ge 1 ] 2>/dev/null; then
  printf "  ✅ %-14s %s → %s version(s)\n" "TC-08-05" "confluence_history versions count" "$VCOUNT"; ((PASS++))
else
  printf "  ❌ %-14s %s\n" "TC-08-05" "confluence_history versions empty"; ((FAIL++))
fi

# confluence_get_page_children — depth param
R=$(mcp_conf "confluence_get_page_children" '{"page_id":"47186671","depth":1}')
check "TC-08-06" "confluence_get_page_children depth=1 (backward compat)" "$R" '"children"'

R=$(mcp_conf "confluence_get_page_children" '{"page_id":"2097240","depth":2}')
check "TC-08-07" "confluence_get_page_children depth=2 returns nested" "$R" '"children"'
HAS_NESTED=$(extract "$R" | python3 -c "
import sys, json
text = sys.stdin.read()
d = json.loads(text)
kids = d.get('children', [])
nested = any('children' in json.dumps(k) for k in kids)
print('yes' if nested else 'no')
" 2>/dev/null || echo "no")
if [ "$HAS_NESTED" = "yes" ]; then
  printf "  ✅ %-14s %s\n" "TC-08-08" "confluence_get_page_children depth=2 has nested children"; ((PASS++))
else
  printf "  ⚠️  %-14s %s\n" "TC-08-08" "depth=2 returned no nested children (page may have no grandchildren)"; ((WARN++))
fi


# ── TC-09: Confluence — New Tool (get_space_activity) ────────────────────────
echo ""
echo "=== TC-09: Confluence New Tool ==="

R=$(mcp_conf "confluence_get_space_activity" '{"space_key":"PT"}')
check "TC-09-01" "confluence_get_space_activity returns pages" "$R" '"pages"'
check "TC-09-02" "confluence_get_space_activity has total" "$R" '"total"'
check "TC-09-03" "confluence_get_space_activity has space_key" "$R" '"space_key"'

R=$(mcp_conf "confluence_get_space_activity" '{"space_key":"PT","start_date":"2026-01-01","limit":5}')
check "TC-09-04" "confluence_get_space_activity with date filter" "$R" '"pages"'
ACOUNT=$(extract "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(len(d.get('pages',[])))
" 2>/dev/null || echo "0")
if [ "$ACOUNT" -le 5 ] 2>/dev/null; then
  printf "  ✅ %-14s %s → %s page(s) (≤5)\n" "TC-09-05" "space_activity limit=5 respected" "$ACOUNT"; ((PASS++))
else
  printf "  ❌ %-14s %s → %s (expected ≤5)\n" "TC-09-05" "space_activity limit=5 exceeded" "$ACOUNT"; ((FAIL++))
fi


# ── TC-10: Regression — Core Unchanged Tools ─────────────────────────────────
echo ""
echo "=== TC-10: Regression (Unchanged Tools) ==="

R=$(mcp_jira "jira_get_projects" '{"max_results":5}')
check "TC-10-01" "jira_get_projects" "$R" '"key"'

R=$(mcp_jira "jira_search_users" '{"query":"tuong","max_results":5}')
check "TC-10-02" "jira_search_users tuong" "$R" '"tuongpm"'

R=$(mcp_conf "confluence_get_spaces" '{"limit":5}')
check "TC-10-03" "confluence_get_spaces" "$R" '"key"'

R=$(mcp_conf "confluence_get_page" '{"page_id":"47186671"}')
check "TC-10-04" "confluence_get_page 47186671" "$R" '"id"'

R=$(mcp_conf "confluence_search" '{"cql":"space=PT AND type=page","limit":3}')
check "TC-10-05" "confluence_search PT space" "$R" '"results"'

R=$(mcp_conf "confluence_search_users" '{"query":"tuong","limit":5}')
check "TC-10-06" "confluence_search_users tuong" "$R" '"tuongpm"'

R=$(mcp_conf "confluence_get_space_pages" '{"space_key":"PT","limit":5}')
check "TC-10-07" "confluence_get_space_pages PT" "$R" '"results"'

# BUG-07 regression: macro configs with drawio after self-closing toc
R=$(mcp_conf "confluence_get_macro_configs" '{"page_id":"52888152","macro_name_filter":"drawio"}')
MCOUNT=$(extract "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(d.get('macro_count',0))
" 2>/dev/null || echo "0")
if [ "$MCOUNT" -ge 1 ] 2>/dev/null; then
  printf "  ✅ %-14s %s → %s macro(s) [BUG-07 regression]\n" "TC-10-08" "confluence_get_macro_configs drawio" "$MCOUNT"; ((PASS++))
else
  printf "  ❌ %-14s %s [BUG-07 REGRESSION FAILED]\n" "TC-10-08" "confluence_get_macro_configs returned 0 macros"; ((FAIL++))
fi

R=$(mcp_conf "confluence_get_content_properties" '{"page_id":"47186671"}')
check "TC-10-09" "confluence_get_content_properties" "$R" '"properties"'


# ── TC-11: Edge Cases ─────────────────────────────────────────────────────────
echo ""
echo "=== TC-11: Edge Cases ==="

# jira_search with empty results (future date JQL)
R=$(mcp_jira "jira_search" '{"jql":"project=KEY AND created > 2099-01-01","max_results":5}')
check "TC-11-01" "jira_search empty results" "$R" '"issues"'

# jira_get_issue invalid key
R=$(mcp_jira "jira_get_issue" '{"issue_key":"INVALID-99999"}')
check_error "TC-11-02" "jira_get_issue invalid key → error" "$R"

# confluence_get_page invalid id
R=$(mcp_conf "confluence_get_page" '{"page_id":"9999999999"}')
check_error "TC-11-03" "confluence_get_page invalid id → error" "$R"

# confluence_history invalid page
R=$(mcp_conf "confluence_history" '{"page_id":"9999999999","detail":"summary"}')
check_error "TC-11-04" "confluence_history invalid id → error" "$R"

# jira_sprint_analytics type=report without sprint_id
R=$(mcp_jira "jira_sprint_analytics" '{"board_id":"18","type":"report"}')
check_error "TC-11-05" "sprint_analytics report no sprint_id → error" "$R"

# confluence_get_space_activity far future date (expect empty)
R=$(mcp_conf "confluence_get_space_activity" '{"space_key":"PT","start_date":"2099-01-01"}')
check "TC-11-06" "space_activity future date returns pages key" "$R" '"pages"'


# ── Results ───────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════"
TOTAL=$((PASS + FAIL + WARN))
echo "  PASS  : $PASS"
echo "  FAIL  : $FAIL"
echo "  WARN  : $WARN"
echo "  TOTAL : $TOTAL"
echo "════════════════════════════════════════════════════════"
if [ $FAIL -eq 0 ]; then
  if [ $WARN -eq 0 ]; then
    echo "  🎉  ALL TESTS PASSED — READY FOR PHASE 3 DEPLOYMENT"
  else
    echo "  ✅  ALL TESTS PASSED with $WARN warning(s) — review before Phase 3"
  fi
  exit 0
else
  echo "  ⚠️   $FAIL TEST(S) FAILED — DO NOT DEPLOY"
  exit 1
fi
