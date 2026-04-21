# SETUP-PHASE3.md
# Hướng dẫn kết nối Split Workers vào Claude.ai
# Jira: jira.tuongbeo.workers.dev | Confluence: confluence.tuongbeo.workers.dev

---

## Tổng quan

Phase 3 đã deploy 2 workers độc lập. Mỗi worker có domain riêng,
tool budget riêng (15 Jira + 22 Confluence), OAuth flow riêng.

Để hoạt động, cần tạo **2 Application Links mới** trong Jira DC và Confluence DC
với redirect URI trỏ vào callback URL của từng worker.

---

## Bước 1 — Tạo Application Link trong Jira DC

### 1.1 Truy cập Jira Admin

```
https://jira.pila.vn/plugins/servlet/applinks/listApplicationLinks
```
Hoặc: Jira → ⚙️ Admin → **Applications → Application Links**

### 1.2 Tạo link mới

1. Click **Create link**
2. Chọn **External application**
3. Chọn hướng **Incoming**
4. Điền thông tin:

   | Field | Giá trị |
   |---|---|
   | Name | `MCP Jira Worker (jira.tuongbeo.workers.dev)` |
   | Redirect URL | **`https://jira.tuongbeo.workers.dev/callback`** |
   | Application type | Generic Application |
   | Scopes | ✅ **READ** ✅ **WRITE** |

5. Click **Save**

### 1.3 Copy credentials

Sau khi save, Jira sẽ hiện:
- **Client ID** (UUID dạng `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
- **Client Secret**

**Lưu lại cả hai** — cần để cấu hình connector.

---

## Bước 2 — Tạo Application Link trong Confluence DC

### 2.1 Truy cập Confluence Admin

```
https://cms.pila.vn/plugins/servlet/applinks/listApplicationLinks
```
Hoặc: Confluence → ⚙️ Admin → **General Configuration → Application Links**

### 2.2 Tạo link mới

1. Click **Create link** → External application → **Incoming**
2. Điền thông tin:

   | Field | Giá trị |
   |---|---|
   | Name | `MCP Confluence Worker (confluence.tuongbeo.workers.dev)` |
   | Redirect URL | **`https://confluence.tuongbeo.workers.dev/callback`** |
   | Scopes | ✅ **READ** ✅ **WRITE** |

3. Click **Save** → Copy **Client ID** và **Client Secret**

---

## Bước 3 — Thêm Connectors vào Claude.ai

Vào **Claude.ai → Settings → Connectors → Add connector**

### 3.1 Jira Connector

| Field | Giá trị |
|---|---|
| Connector URL | `https://jira.tuongbeo.workers.dev/mcp` |
| Client ID | `https://jira.pila.vn\|\|{JIRA_CLIENT_ID_FROM_STEP_1}` |
| Client Secret | `{JIRA_CLIENT_SECRET_FROM_STEP_1}` |

**Ví dụ client_id:**
`https://jira.pila.vn||abc12345-def6-7890-ghij-klmnopqrstuv`

### 3.2 Confluence Connector

| Field | Giá trị |
|---|---|
| Connector URL | `https://confluence.tuongbeo.workers.dev/mcp` |
| Client ID | `https://cms.pila.vn\|\|{CONFLUENCE_CLIENT_ID_FROM_STEP_2}` |
| Client Secret | `{CONFLUENCE_CLIENT_SECRET_FROM_STEP_2}` |

---

## Bước 4 — Authorize (lần đầu)

Sau khi add connector, Claude.ai sẽ hỏi authorize:

1. Jira connector → click **Authorize** → redirect tới `jira.pila.vn`
2. Đăng nhập Jira bằng tài khoản `tuongpm` → **Allow**
3. Redirect về Claude.ai → Jira connector **Connected** ✅
4. Làm tương tự cho Confluence connector

---

## Bước 5 — Verify

Kiểm tra trong chat Claude.ai:

```
Jira: Liệt kê 3 issues gần nhất trong project KEY
Confluence: Lấy thông tin page 47186671
```

Nếu cả hai trả về kết quả → Phase 3 hoàn thành ✅

---

## Worker Endpoints Reference

| Worker | URL | MCP endpoint | OAuth |
|---|---|---|---|
| `atlassian` (multi, giữ nguyên) | `atlassian.tuongbeo.workers.dev` | `/jira/mcp`, `/confluence/mcp` | `/jira/authorize`, `/confluence/authorize` |
| `jira` (split, mới) | `jira.tuongbeo.workers.dev` | `/mcp` | `/authorize` |
| `confluence` (split, mới) | `confluence.tuongbeo.workers.dev` | `/mcp` | `/authorize` |

---

## Secrets Reference (đã set, không cần làm lại)

| Worker | JWT_SECRET | PUBLIC_BASE_URL |
|---|---|---|
| `jira` | 020c032f... (64 chars) | `https://jira.tuongbeo.workers.dev` |
| `confluence` | ec382151... (64 chars) | `https://confluence.tuongbeo.workers.dev` |

---

## Troubleshooting

**"Code expired" khi authorize:**
Redirect URI trong App Link không khớp với callback URL của worker.
Kiểm tra Redirect URL trong App Link = `https://{worker}.tuongbeo.workers.dev/callback`

**"client_id mismatch":**
Format client_id phải là `{instanceUrl}||{atlassianClientId}` — không có space,
dùng `||` (hai dấu pipe) làm separator.

**Confluence App Link ở đâu:**
`cms.pila.vn` → Admin → General Configuration → cuộn xuống → **Application Links**
hoặc thử trực tiếp: `cms.pila.vn/plugins/servlet/applinks/listApplicationLinks`

**Xem danh sách OAuth Apps đã tạo trong Jira:**
`jira.pila.vn/plugins/servlet/oauth2/apps`
