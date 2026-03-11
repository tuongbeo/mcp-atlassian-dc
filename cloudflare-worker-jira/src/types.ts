export interface Env {
  // ─── Atlassian OAuth 2.0 Application Link (cấu hình trong Jira Admin → Application Links) ──
  ATLASSIAN_OAUTH_CLIENT_ID: string;
  ATLASSIAN_OAUTH_CLIENT_SECRET: string;

  // URL callback — phải khớp với "Redirect URI" trong Application Link
  // Ví dụ: https://mcp-jira.pilacorp.workers.dev/callback
  ATLASSIAN_OAUTH_REDIRECT_URI: string;

  // ─── Atlassian Data Center Instance URLs ─────────────────────────────────
  JIRA_URL: string;        // https://jira.pila.vn

  // OAuth server của Jira DC — thường bằng JIRA_URL
  // Endpoint: ${OAUTH_BASE_URL}/rest/oauth2/latest/authorize|token
  OAUTH_BASE_URL: string;  // https://jira.pila.vn

  // ─── Worker config ────────────────────────────────────────────────────────
  PUBLIC_BASE_URL: string; // https://mcp-jira.pilacorp.workers.dev
  JWT_SECRET: string;

  // ─── Cloudflare bindings ──────────────────────────────────────────────────
  OAUTH_KV: KVNamespace;
}

// Payload nhúng vào proxy JWT — stateless, không lưu file
// DC không dùng cloud_id
export interface ProxyJWTPayload {
  sub: string;                        // username / accountId từ Jira
  atlassian_access_token: string;     // Jira DC access token
  atlassian_refresh_token: string;    // Jira DC refresh token (có thể rỗng)
  iat: number;
  exp: number;
}

export interface OAuthStateRecord {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}

export interface AuthCodeRecord {
  proxy_jwt: string;
  client_id: string;
  redirect_uri: string;
}

export interface DCRClientRecord {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
  client_name: string;
  created_at: number;
}
