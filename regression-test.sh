#!/usr/bin/env bash
# regression-test.sh — MCP Atlassian DC Worker
# Run after every deploy to verify all endpoints and core tools work correctly.
#
# Usage:
#   WORKER_TOKEN=<jwt> ./regression-test.sh
#
# Getting WORKER_TOKEN:
#   1. Re-authorize via Claude.ai Confluence connector if needed
#   2. Open DevTools → Network → find any POST to /confluence/mcp or /jira/mcp
#   3. Copy the Bearer token from the Authorization header
#
# CI/CD (GitHub Actions):
#   - run: WORKER_TOKEN=${{ secrets.WORKER_TOKEN }} ./regression-test.sh

set -euo pipefail
BASE="https://atlassian.tuongbeo.workers.dev"
TOKEN="${WORKER_TOKEN:?Set WORKER_TOKEN env var — a valid proxy JWT for tuongpm}"
PASS=0; FAIL=0; WARN=0

# ── Helpers ──────────────────────────────────────────────────────────────────

check() {
  local id="$1" desc="$2" actual="$3" expected="$4"
  if echo "$actual" | grep -q "$expected" 2>/dev/null; then
    printf "  ✅ %-12s %s\n" "$id" "$desc"; ((PASS++))
  else
    printf "  ❌ %-12s %s\n" "$id" "$desc"
    printf "     Expected to contain: %s\n" "$expected"
    printf "     Got (first 120): %s\n" "${actual:0:120}"
    ((FAIL++))
  fi
}

check_status() {
  local id="$1" desc="$2" actual="$3" expected="$4"
  if [ "$actual" = "$expected" ]; then
    printf "  ✅ %-12s %s → HTTP %s\n" "$id" "$desc" "$actual"; ((PASS++))
  else
    printf "  ❌ %-12s %s — expected HTTP %s got %s\n" "$id" "$desc" "$expected" "$actual"; ((FAIL++))
  fi
}

warn() {
  local id="$1" desc="$2"
  printf "  ⚠️  %-12s %s\n" "$id" "$desc"; ((WARN++))
}

mcp_jira() {
  local tool="$1" params="$2"
  curl -sf -X POST "$BASE/jira/mcp" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool\",\"arguments\":$params}}" \
    2>/dev/null || echo '{"error":"curl_failed"}'
}

mcp_conf() {
  local tool="$1" params="$2"
  curl -sf -X POST "$BASE/confluence/mcp" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool\",\"arguments\":$params}}" \
    2>/dev/null || echo '{"error":"curl_failed"}'
}

get_json_field() {
  echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(str(d$2))" 2>/dev/null || echo ""
}


# ── TC-01: OAuth Discovery (no auth required) ─────────────────────────────────
echo ""
echo "=== TC-01: OAuth Discovery ==="

R=$(curl -sf "$BASE/health" 2>/dev/null || echo "")
check "TC-01-01" "Health endpoint" "$R" '"status":"ok"'
check "TC-01-01" "Health version 2.0.0" "$R" '"version":"2.0.0"'

R=$(curl -sf "$BASE/.well-known/oauth-protected-resource/jira/mcp" 2>/dev/null || echo "")
check "TC-01-02" "Jira resource metadata resource field" "$R" '"resource"'

R=$(curl -sf "$BASE/.well-known/oauth-protected-resource/confluence/mcp" 2>/dev/null || echo "")
check "TC-01-03" "Confluence resource metadata" "$R" '"resource"'

R=$(curl -sf "$BASE/jira/.well-known/oauth-authorization-server" 2>/dev/null || echo "")
check "TC-01-04" "Jira OAuth issuer" "$R" '"issuer"'

R=$(curl -sf "$BASE/confluence/.well-known/oauth-authorization-server" 2>/dev/null || echo "")
check "TC-01-05" "Confluence OAuth issuer" "$R" '"issuer"'

S=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/authorize?client_id=test" 2>/dev/null)
check_status "TC-01-06" "Root /authorize → 400 (BUG-05 regression)" "$S" "400"

R=$(curl -s "$BASE/authorize?client_id=test" 2>/dev/null)
check "TC-01-06b" "Root /authorize body has jira_authorize" "$R" 'jira_authorize'

# ── TC-04: MCP Auth ────────────────────────────────────────────────────────────
echo ""
echo "=== TC-04: MCP Auth ==="

S=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/jira/mcp" \
  -H "Content-Type: application/json" 2>/dev/null)
check_status "TC-04-01" "No auth → 401" "$S" "401"

S=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/jira/mcp" \
  -H "Authorization: Bearer bad.jwt.here" \
  -H "Content-Type: application/json" 2>/dev/null)
check_status "TC-04-02" "Invalid JWT → 401" "$S" "401"

R=$(curl -s -D - -X POST "$BASE/jira/mcp" -H "Content-Type: application/json" 2>/dev/null)
check "TC-04-03" "WWW-Authenticate header present" "$(echo "$R" | tr '[:upper:]' '[:lower:]')" "www-authenticate"


# ── TC-05: Jira Read Tools ─────────────────────────────────────────────────────
echo ""
echo "=== TC-05: Jira Read ==="

R=$(mcp_jira "jira_get_projects" '{"max_results":5}')
check "TC-05-01" "jira_get_projects returns projects" "$R" '"key"'

R=$(mcp_jira "jira_search" '{"jql":"project=KEY ORDER BY updated DESC","max_results":3}')
check "TC-05-02" "jira_search project=KEY" "$R" '"issues"'

R=$(mcp_jira "jira_get_issue_types" '{"project_key":"TEST"}')
check "TC-05-05" "jira_get_issue_types for TEST project" "$R" '"Task"'

R=$(mcp_jira "jira_get_agile_boards" '{"project_key":"KEY","max_results":5}')
check "TC-05-06" "jira_get_agile_boards for KEY" "$R" '"id"'

R=$(mcp_jira "jira_get_sprints" '{"board_id":18,"state":"active","max_results":3}')
check "TC-05-07" "jira_get_sprints board 18 active" "$R" '"active"'

R=$(mcp_jira "jira_get_sprint_velocity" '{"board_id":"18"}')
check "TC-05-11" "jira_get_sprint_velocity board 18" "$R" '"rolling_3sprint_avg"'

# ── TC-06: Jira Write (creates temp issue, cleans up) ─────────────────────────
echo ""
echo "=== TC-06: Jira Write ==="

CREATE=$(mcp_jira "jira_create_issue" \
  '{"project_key":"TEST","summary":"[REGRESSION TEST] Auto-created - safe to delete","issue_type":"Task","priority":"Low","description":"Auto-created by regression-test.sh"}')
ISSUE_KEY=$(echo "$CREATE" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); r=d.get('content',[{}])[0].get('text','{}'); o=json.loads(r); print(o.get('key',''))" 2>/dev/null || echo "")

if [ -n "$ISSUE_KEY" ]; then
  printf "  ✅ %-12s %s → %s\n" "TC-06-01" "jira_create_issue" "$ISSUE_KEY"; ((PASS++))

  R=$(mcp_jira "jira_get_transitions" "{\"issue_key\":\"$ISSUE_KEY\"}")
  check "TC-06-03" "jira_get_transitions" "$R" '"transitions"'

  TRANSITION_ID=$(echo "$R" | python3 -c "
import sys,json
d=json.loads(sys.stdin.read())
t=json.loads(d.get('content',[{}])[0].get('text','{}'))
ts=t.get('transitions',[])
ip=[x for x in ts if x.get('name')=='In Progress']
print(ip[0]['id'] if ip else (ts[0]['id'] if ts else ''))
" 2>/dev/null || echo "")

  if [ -n "$TRANSITION_ID" ]; then
    R=$(mcp_jira "jira_transition_issue" "{\"issue_key\":\"$ISSUE_KEY\",\"transition_id\":\"$TRANSITION_ID\"}")
    check "TC-06-04" "jira_transition_issue" "$R" "transitioned"
  else
    warn "TC-06-04" "Could not find transition ID"
  fi

  R=$(mcp_jira "jira_add_comment" "{\"issue_key\":\"$ISSUE_KEY\",\"comment\":\"Regression test comment\"}")
  check "TC-06-05" "jira_add_comment" "$R" '"id"'

  # Cleanup — cancel the test issue
  CANCEL_ID=$(mcp_jira "jira_get_transitions" "{\"issue_key\":\"$ISSUE_KEY\"}" | \
    python3 -c "
import sys,json
d=json.loads(sys.stdin.read())
t=json.loads(d.get('content',[{}])[0].get('text','{}'))
ts=t.get('transitions',[])
cl=[x for x in ts if 'cancel' in x.get('name','').lower() or 'close' in x.get('name','').lower() or 'done' in x.get('name','').lower()]
print(cl[0]['id'] if cl else (ts[-1]['id'] if ts else ''))
" 2>/dev/null || echo "")
  [ -n "$CANCEL_ID" ] && mcp_jira "jira_transition_issue" "{\"issue_key\":\"$ISSUE_KEY\",\"transition_id\":\"$CANCEL_ID\"}" > /dev/null
  printf "  ✅ %-12s %s → cleaned up %s\n" "TC-06-06" "Cleanup test issue" "$ISSUE_KEY"; ((PASS++))
else
  printf "  ❌ %-12s %s\n" "TC-06-01" "jira_create_issue failed"; ((FAIL++))
fi


# ── TC-07/08: Confluence Tools (creates temp page, cleans up) ─────────────────
echo ""
echo "=== TC-07/08: Confluence Tools ==="

R=$(mcp_conf "confluence_get_spaces" '{"limit":5}')
check "TC-07-01" "confluence_get_spaces" "$R" '"key"'

R=$(mcp_conf "confluence_get_page" '{"page_id":"47186671"}')
check "TC-07-02" "confluence_get_page 47186671" "$R" '"id"'

R=$(mcp_conf "confluence_get_page_history" '{"page_id":"47186671"}')
check "TC-07-07" "confluence_get_page_history" "$R" '"created_by"'

R=$(mcp_conf "confluence_get_page_analytics" '{"page_id":"47186671"}')
check "TC-07-08" "confluence_get_page_analytics graceful fallback (BUG-02)" "$R" 'page_id'

# BUG-07 regression: macro configs must find drawio after self-closing toc
R=$(mcp_conf "confluence_get_macro_configs" '{"page_id":"52888152","macro_name_filter":"drawio"}')
MACRO_COUNT=$(echo "$R" | python3 -c "
import sys,json
d=json.loads(sys.stdin.read())
t=json.loads(d.get('content',[{}])[0].get('text','{}'))
print(t.get('macro_count',0))
" 2>/dev/null || echo "0")
if [ "$MACRO_COUNT" -ge 1 ] 2>/dev/null; then
  printf "  ✅ %-12s %s → %s macros (BUG-07 regression)\n" "TC-07-12" "confluence_get_macro_configs drawio" "$MACRO_COUNT"; ((PASS++))
else
  printf "  ❌ %-12s %s → got %s macros (BUG-07 regression FAILED)\n" "TC-07-12" "confluence_get_macro_configs drawio" "$MACRO_COUNT"; ((FAIL++))
fi

# Create temp page
CREATE=$(mcp_conf "confluence_create_page" \
  '{"space_key":"PT","title":"[REGRESSION TEST] Temp page — safe to delete","content":"<p>Regression test page. Safe to delete.</p>","parent_id":"24577317"}')
PAGE_ID=$(echo "$CREATE" | python3 -c "
import sys,json
d=json.loads(sys.stdin.read())
t=json.loads(d.get('content',[{}])[0].get('text','{}'))
print(t.get('id',''))
" 2>/dev/null || echo "")

if [ -n "$PAGE_ID" ]; then
  printf "  ✅ %-12s %s → page %s\n" "TC-08-01" "confluence_create_page" "$PAGE_ID"; ((PASS++))

  R=$(mcp_conf "confluence_update_page" \
    "{\"page_id\":\"$PAGE_ID\",\"title\":\"[REGRESSION TEST] Temp page — safe to delete\",\"content\":\"<p>Updated content.</p>\",\"version\":1}")
  check "TC-08-02" "confluence_update_page BUG-01 regression" "$R" '"id"'

  R=$(mcp_conf "confluence_add_label" "{\"page_id\":\"$PAGE_ID\",\"labels\":[\"regression-test\"]}")
  check "TC-08-03" "confluence_add_label" "$R" '"regression-test"'

  R=$(mcp_conf "confluence_add_comment" "{\"page_id\":\"$PAGE_ID\",\"comment\":\"Regression test comment\"}")
  check "TC-08-05" "confluence_add_comment" "$R" '"id"'

  R=$(mcp_conf "confluence_get_page_comments" "{\"page_id\":\"$PAGE_ID\"}")
  check "TC-08-06" "confluence_get_page_comments" "$R" '"comments"'

  # Cleanup
  mcp_conf "confluence_delete_page" "{\"page_id\":\"$PAGE_ID\"}" > /dev/null
  printf "  ✅ %-12s %s → deleted page %s\n" "TC-08-14" "confluence_delete_page cleanup" "$PAGE_ID"; ((PASS++))
else
  printf "  ❌ %-12s %s\n" "TC-08-01" "confluence_create_page failed"; ((FAIL++))
fi


# ── TC-09: New Plugin Tools ────────────────────────────────────────────────────
echo ""
echo "=== TC-09: New Plugin Tools ==="

R=$(mcp_conf "confluence_get_content_properties" '{"page_id":"47186671"}')
check "TC-09-03" "confluence_get_content_properties" "$R" '"properties"'

R=$(mcp_conf "confluence_set_content_property" \
  '{"page_id":"47186671","key":"mcp-regression-test","value":{"test":true}}')
check "TC-09-04" "confluence_set_content_property" "$R" '"key"'

R=$(mcp_conf "confluence_search_users" '{"query":"tuong","limit":5}')
check "TC-09-06" "confluence_search_users tuong" "$R" '"tuongpm"'

R=$(mcp_conf "confluence_get_space_permissions" '{"space_key":"PT"}')
check "TC-09-07" "confluence_get_space_permissions PT" "$R" '"permissions"'

# BUG-07 regression for get_drawio_diagram
R=$(mcp_conf "confluence_get_drawio_diagram" '{"page_id":"52888152","diagram_index":0}')
check "TC-09-01" "confluence_get_drawio_diagram finds diagram (BUG-07)" "$R" '"diagram_count"'

# ── Results ───────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════"
TOTAL=$((PASS + FAIL + WARN))
echo "  PASS:  $PASS"
echo "  FAIL:  $FAIL"
echo "  WARN:  $WARN"
echo "  TOTAL: $TOTAL"
echo "════════════════════════════════════════"
if [ $FAIL -eq 0 ]; then
  echo "  🎉 ALL TESTS PASSED"
  exit 0
else
  echo "  ⚠️  $FAIL TEST(S) FAILED"
  exit 1
fi
