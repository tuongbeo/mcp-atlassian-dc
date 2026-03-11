# MCP Atlassian — Cloudflare Workers

Cloudflare Workers port của `mcp-atlassian-dc`, hỗ trợ OAuth 2.0 (3LO) hoàn toàn stateless.

## Kiến trúc

```
Claude.ai
  │
  ├─ 1. GET /mcp → 401 + WWW-Authenticate
  ├─ 2. GET /.well-known/oauth-authorization-server
  ├─ 3. POST /register (Dynamic Client Registration)
  ├─ 4. GET /authorize → redirect sang Atlassian OAuth consent
  │      └─ User đăng nhập và đồng ý trên Atlassian
  ├─ 5. GET /callback → Worker đổi code → Atlassian tokens → proxy JWT
  ├─ 6. POST /token → trả proxy JWT cho Claude.ai
  └─ 7. ALL /mcp + Bearer <proxy JWT> → MCP tools
```

Atlassian OAuth token được **nhúng trực tiếp vào proxy JWT** (stateless) — không cần lưu file hay volume.

## Yêu cầu

- Node.js 18+
- Wrangler CLI: `npm install -g wrangler`
- Cloudflare account (Workers Paid Plan — cần Durable Objects)
- Atlassian OAuth App đã tạo tại [developer.atlassian.com](https://developer.atlassian.com)

## Cài đặt

```bash
cd cloudflare-worker
npm install
```

## Cấu hình

### 1. Tạo KV Namespace

```bash
wrangler kv namespace create OAUTH_KV
# Copy ID được in ra và paste vào wrangler.jsonc → "id": "YOUR_KV_ID"

# Cho production:
wrangler kv namespace create OAUTH_KV --env production
```

### 2. Set Secrets

```bash
# Atlassian OAuth App credentials
wrangler secret put ATLASSIAN_OAUTH_CLIENT_ID
wrangler secret put ATLASSIAN_OAUTH_CLIENT_SECRET

# URLs của Atlassian instance
wrangler secret put JIRA_URL
# → https://jira.yourcompany.com

wrangler secret put CONFLUENCE_URL
# → https://confluence.yourcompany.com

# Tạo JWT_SECRET ngẫu nhiên
wrangler secret put JWT_SECRET
# → chạy: openssl rand -hex 32

# Sau khi deploy xong, lấy URL rồi set:
wrangler secret put PUBLIC_BASE_URL
# → https://mcp-atlassian.YOUR-SUBDOMAIN.workers.dev

wrangler secret put ATLASSIAN_OAUTH_REDIRECT_URI
# → https://mcp-atlassian.YOUR-SUBDOMAIN.workers.dev/callback
```

### 3. Cập nhật Atlassian Developer Console

Vào [developer.atlassian.com](https://developer.atlassian.com) → OAuth app của bạn:

```
Callback URL cũ: https://mcp-atlassian.up.railway.app/callback
Callback URL mới: https://mcp-atlassian.YOUR-SUBDOMAIN.workers.dev/callback
```

## Deploy

```bash
# Development (local)
npm run dev
# → http://localhost:8787

# Production
npm run deploy
# → https://mcp-atlassian.YOUR-SUBDOMAIN.workers.dev
```

## Test

```bash
# Health check
curl https://mcp-atlassian.YOUR-SUBDOMAIN.workers.dev/health

# OAuth discovery
curl https://mcp-atlassian.YOUR-SUBDOMAIN.workers.dev/.well-known/oauth-authorization-server

# MCP endpoint (nên trả 401)
curl https://mcp-atlassian.YOUR-SUBDOMAIN.workers.dev/mcp
```

## Cập nhật config Claude.ai

Vào **Settings > Connectors** trên claude.ai:

```
URL cũ: https://mcp-atlassian.up.railway.app
URL mới: https://mcp-atlassian.YOUR-SUBDOMAIN.workers.dev/mcp
```

## So sánh với Railway config cũ

| Biến Railway | Cloudflare tương đương |
|---|---|
| `ATLASSIAN_OAUTH_CLIENT_ID` | `wrangler secret put ATLASSIAN_OAUTH_CLIENT_ID` |
| `ATLASSIAN_OAUTH_CLIENT_SECRET` | `wrangler secret put ATLASSIAN_OAUTH_CLIENT_SECRET` |
| `ATLASSIAN_OAUTH_REDIRECT_URI` | `wrangler secret put ATLASSIAN_OAUTH_REDIRECT_URI` |
| `PUBLIC_BASE_URL` | `wrangler secret put PUBLIC_BASE_URL` |
| `JIRA_URL` | `wrangler secret put JIRA_URL` |
| `CONFLUENCE_URL` | `wrangler secret put CONFLUENCE_URL` |
| `MCP_ATLASSIAN_TOKEN_DIR=/data` | **Không cần** — stateless JWT |
| `ATLASSIAN_OAUTH_PROXY_ENABLE=true` | **Không cần** — built-in |
| `STATELESS=true` | **Không cần** — always stateless |
| `TRANSPORT=streamable-http` | **Không cần** — always HTTP |
| `ATLASSIAN_OAUTH_SCOPE` | **Không cần** — hardcoded trong oauth.ts |
| `JWT_SECRET` | **Mới** — `wrangler secret put JWT_SECRET` |

## MCP Tools

### Jira (9 tools)
| Tool | Mô tả |
|---|---|
| `jira_search` | Tìm issues bằng JQL |
| `jira_get_issue` | Lấy chi tiết một issue |
| `jira_create_issue` | Tạo issue mới |
| `jira_update_issue` | Cập nhật issue |
| `jira_get_transitions` | Lấy danh sách transitions |
| `jira_transition_issue` | Chuyển status |
| `jira_add_comment` | Thêm comment |
| `jira_get_projects` | Danh sách projects |
| `jira_search_users` | Tìm user (lấy accountId) |

### Confluence (8 tools)
| Tool | Mô tả |
|---|---|
| `confluence_search` | Tìm content bằng CQL |
| `confluence_get_page` | Lấy nội dung trang |
| `confluence_create_page` | Tạo trang mới |
| `confluence_update_page` | Cập nhật trang |
| `confluence_get_spaces` | Danh sách spaces |
| `confluence_get_space_pages` | Pages trong space |
| `confluence_add_comment` | Thêm comment |
| `confluence_get_page_children` | Pages con |
