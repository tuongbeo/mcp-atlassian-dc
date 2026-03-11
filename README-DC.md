# mcp-atlassian-dc

Fork của [sooperset/mcp-atlassian](https://github.com/sooperset/mcp-atlassian) với bổ sung **OAuth 2.0 (3LO) wizard cho Jira/Confluence Data Center**.

## Thay đổi so với bản gốc

| File | Thay đổi |
|---|---|
| `src/mcp_atlassian/utils/oauth_setup.py` | Thêm `run_dc_oauth_setup()` + `run_dc_oauth_flow()` |
| `src/mcp_atlassian/__init__.py` | Thêm CLI flag `--dc-oauth-setup` |
| `.env.example` | Template env vars cho DC |

---

## Cài đặt

```bash
cd /Users/tuongbeo/Development/mcp-atlassian-dc
uv sync
```

---

## Setup OAuth 2.0 cho Jira Data Center

### Bước 1 — Admin tạo Application Link (làm 1 lần)

1. Jira Admin Panel → **Applications → Application Links**
2. **Create link** → External application → **Incoming**
3. Điền thông tin:
   - Name: `MCP Atlassian`
   - Redirect URL: `http://localhost:8080/callback`
4. Enable scopes: **READ**, **WRITE**
5. Save → Copy **Client ID** và **Client Secret**

### Bước 2 — Mỗi user chạy wizard (làm 1 lần)

```bash
mcp-atlassian --dc-oauth-setup
```

Wizard sẽ hỏi:
- Jira DC URL (ví dụ: `https://jira.pila.vn`)
- Confluence DC URL (optional)
- Client ID
- Client Secret
- Redirect URI (default: `http://localhost:8080/callback`)
- Scope (default: `READ WRITE`)

Sau đó mở browser → Jira consent screen → user đăng nhập và approve → tokens được lưu tự động.

### Bước 3 — Start server

```bash
# Stdio (mặc định)
mcp-atlassian

# HTTP transport (cho Railway)
mcp-atlassian --transport streamable-http --stateless
```

---

## Cấu hình env vars

Copy `.env.example` thành `.env` và điền thông tin:

```bash
cp .env.example .env
```

Hoặc set environment variables trực tiếp:

```bash
JIRA_URL=https://jira.pila.vn
CONFLUENCE_URL=https://confluence.pila.vn
ATLASSIAN_OAUTH_CLIENT_ID=your_client_id
ATLASSIAN_OAUTH_CLIENT_SECRET=your_client_secret
ATLASSIAN_OAUTH_REDIRECT_URI=http://localhost:8080/callback
ATLASSIAN_OAUTH_SCOPE=READ WRITE
```

---

## So sánh phương thức xác thực

| | PAT | DC OAuth 2.0 |
|---|---|---|
| Setup | Đơn giản | Trung bình |
| Bảo mật | Trung bình | Cao |
| User consent screen | Không | Có |
| Token expiry | Configurable | 2h (auto-refresh) |
| Auto refresh | Không | Có |
| Audit trail | Giới hạn | Đầy đủ |

**Khuyến nghị**: PAT cho internal tools, DC OAuth cho production/enterprise.

---

## Kiến trúc OAuth Flow

```
User: mcp-atlassian --dc-oauth-setup
         │
         ▼
OAuthConfig(base_url=jira_url)  ← is_data_center = True
         │
         ▼
GET https://jira.pila.vn/rest/oauth2/latest/authorize
    ?client_id=...&redirect_uri=...&response_type=code&scope=READ+WRITE
         │
         ▼ (browser opens, user logs in + approves)
         │
         ▼
Callback: http://localhost:8080/callback?code=AUTH_CODE
         │
         ▼
POST https://jira.pila.vn/rest/oauth2/latest/token
    client_id=...&client_secret=...&code=AUTH_CODE&grant_type=authorization_code
         │
         ▼
{ access_token, refresh_token, expires_in: 7200 }
         │
         ▼
Saved to: ~/.mcp-atlassian/oauth-<client_id>.json + system keyring
```

Token lifecycle:
- **Access token**: ~2 giờ → auto-refresh khi hết hạn
- **Refresh token**: dài hạn → dùng để lấy access token mới
- **Re-auth**: chỉ cần khi refresh token hết hạn hoặc bị admin revoke

---

## Deployment trên Railway

Xem conversation history để biết chi tiết cấu hình Railway với service này.

Railway Variables cần thiết:
```
JIRA_URL=https://jira.pila.vn
CONFLUENCE_URL=https://confluence.pila.vn
ATLASSIAN_OAUTH_CLIENT_ID=<client_id>
ATLASSIAN_OAUTH_CLIENT_SECRET=<client_secret>
TRANSPORT=streamable-http
STATELESS=true
HOST=0.0.0.0
```

Lưu ý: Với Railway deployment (stateless), tokens cần được inject qua `ATLASSIAN_OAUTH_ACCESS_TOKEN` env var hoặc `Authorization: Bearer <token>` header — vì không có filesystem để lưu tokens.
