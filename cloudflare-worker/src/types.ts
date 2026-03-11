export interface Env {
  // ─── Atlassian OAuth App (từ developer.atlassian.com) ────────────────────
  ATLASSIAN_OAUTH_CLIENT_ID: string;
  ATLASSIAN_OAUTH_CLIENT_SECRET: string;

  // URL callback phải khớp với Atlassian Developer Console
  // Ví dụ: https://mcp-atlassian.your-subdomain.workers.dev/callback
  ATLASSIAN_OAUTH_REDIRECT_URI: string;

  // ─── Atlassian Instance URLs ──────────────────────────────────────────────
  JIRA_URL: string;        // https://jira.yourcompany.com
  CONFLUENCE_URL: string;  // https://confluence.yourcompany.com

  // ─── Worker config ────────────────────────────────────────────────────────
  // URL công khai của Worker, không có trailing slash
  // Ví dụ: https://mcp-atlassian.your-subdomain.workers.dev
  PUBLIC_BASE_URL: string;

  // Secret ngẫu nhiên để ký proxy JWT
  // Tạo bằng: openssl rand -hex 32
  JWT_SECRET: string;

  // ─── Cloudflare bindings ──────────────────────────────────────────────────
  OAUTH_KV: KVNamespace;
}

// Payload được nhúng vào proxy JWT (stateless — không lưu file)
export interface ProxyJWTPayload {
  sub: string;                      // cloudId của Atlassian instance
  atlassian_access_token: string;   // Atlassian OAuth access token
  atlassian_refresh_token: string;  // Atlassian OAuth refresh token
  cloud_id: string;                 // Atlassian cloud ID
  iat: number;
  exp: number;
}

// Record lưu trong KV để map state → client info trong OAuth flow
export interface OAuthStateRecord {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}

// Record lưu trong KV sau khi callback — chờ /token đổi
export interface AuthCodeRecord {
  proxy_jwt: string;
  client_id: string;
  redirect_uri: string;
}

// Record Dynamic Client Registration
export interface DCRClientRecord {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
  client_name: string;
  created_at: number;
}
