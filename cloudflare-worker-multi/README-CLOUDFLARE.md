# Atlassian MCP Worker v2.0 — Multi-tenant, Zero Config

Single Cloudflare Worker for all Atlassian DC instances (Jira + Confluence).
**No Cloudflare config changes needed when adding new companies.**

## Live Endpoints

```
Jira MCP      : https://atlassian-mcp.tuongbeo.workers.dev/jira/mcp
Confluence MCP: https://atlassian-mcp.tuongbeo.workers.dev/confluence/mcp
Health        : https://atlassian-mcp.tuongbeo.workers.dev/health
```

## Architecture

```
Claude.ai (any company's Team account)
  ↓
  Jira connector
    MCP URL  : https://atlassian-mcp.tuongbeo.workers.dev/jira/mcp
    Client ID: https://jira.company.com||{atlassian_app_link_id}
    Secret   : {atlassian_app_link_secret}

  Confluence connector
    MCP URL  : https://atlassian-mcp.tuongbeo.workers.dev/confluence/mcp
    Client ID: https://cms.company.com||{atlassian_conf_app_link_id}
    Secret   : {atlassian_conf_app_link_secret}
```

### Cloudflare Secrets (set once, never changes)
```
JWT_SECRET      = <random hex — openssl rand -hex 32>
PUBLIC_BASE_URL = https://atlassian-mcp.tuongbeo.workers.dev
OAUTH_KV        = atlassian-mcp-kv (af2e3b157a1b47f7883652ef93c6e69a)
```

## Adding a New Company

1. **On company's Jira** → Administration → Application Links → Create Incoming Link (OAuth 2.0)
   - Callback URL: `https://atlassian-mcp.tuongbeo.workers.dev/callback`
   - Copy `client_id` and `client_secret`

2. **On company's Confluence** → Same steps, get separate `client_id` and `client_secret`

3. **In Claude.ai** (company's Team account) → Settings → Integrations:
   - Add Jira: URL `.../jira/mcp`, Client ID `https://jira.company.com||{client_id}`, Secret `{secret}`
   - Add Confluence: URL `.../confluence/mcp`, Client ID `https://cms.company.com||{client_id}`, Secret `{secret}`

4. **Cloudflare**: nothing to do. **Code**: nothing to change.

## Tools Available

### Jira (13 tools)
`jira_search` · `jira_get_issue` · `jira_create_issue` · `jira_update_issue`
`jira_get_transitions` · `jira_transition_issue` · `jira_add_comment`
`jira_get_projects` · `jira_search_users` · `jira_get_issue_types`
`jira_get_agile_boards` · `jira_get_sprints` · `jira_get_sprint_issues`

### Confluence (10 tools)
`confluence_search` · `confluence_get_page` · `confluence_get_page_by_title`
`confluence_create_page` · `confluence_update_page` · `confluence_delete_page`
`confluence_get_spaces` · `confluence_get_space_pages`
`confluence_add_comment` · `confluence_get_page_children`

## Security Design
- `client_id` format: `{instanceUrl}||{atlassianAppLinkClientId}`
- Atlassian credentials AES-GCM encrypted before KV storage
- PKCE S256 enforced on all OAuth flows
- Proxy JWT contains only session UUID (`sub`), never raw tokens
- 90-day sliding window refresh token
- Per-service OAuth discovery (`/jira/...` vs `/confluence/...`)

## Development

```bash
npm install
npm run type-check        # TypeScript check
npx wrangler dev          # Local dev
npx wrangler deploy       # Deploy to Cloudflare
```

### First-time Setup
```bash
npx wrangler login
echo "$(openssl rand -hex 32)" | npx wrangler secret put JWT_SECRET --name atlassian-mcp
echo "https://atlassian-mcp.tuongbeo.workers.dev" | npx wrangler secret put PUBLIC_BASE_URL --name atlassian-mcp
npx wrangler deploy
```
