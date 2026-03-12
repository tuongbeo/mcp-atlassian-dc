export interface Env {
  // ─── Atlassian OAuth 2.0 Application Link (cấu hình trong Confluence Admin → Application Links) ──
  ATLASSIAN_OAUTH_CLIENT_ID: string;
  ATLASSIAN_OAUTH_CLIENT_SECRET: string;

  // URL callback — phải khớp với "Redirect URI" trong Application Link
  // Ví dụ: https://confluence.pilacorp.workers.dev/callback
  ATLASSIAN_OAUTH_REDIRECT_URI: string;

  // ─── Atlassian Data Center Instance URLs ─────────────────────────────────
  CONFLUENCE_URL: string;  // https://cms.pila.vn

  // OAuth server của Confluence DC — thường bằng CONFLUENCE_URL
  // Endpoint: ${OAUTH_BASE_URL}/rest/oauth2/latest/authorize|token
  OAUTH_BASE_URL: string;  // https://cms.pila.vn

  // ─── Worker config ────────────────────────────────────────────────────────
  PUBLIC_BASE_URL: string; // https://confluence.pilacorp.workers.dev
  JWT_SECRET: string;

  // ─── Cloudflare bindings ──────────────────────────────────────────────────
  OAUTH_KV: KVNamespace;
}

/**
 * Token record lưu trong KV — key: `token:{sub}`
 * sub là session UUID tạo lúc OAuth callback.
 * TTL trong KV: 90 ngày (tự xóa khi hết hạn).
 */
export interface StoredTokenRecord {
  access_token: string;
  refresh_token: string;
  expires_at: number;      // Unix timestamp — khi nào access_token hết hạn
  oauth_base_url: string;  // Cần cho refresh call: {oauth_base_url}/rest/oauth2/latest/token
}

export interface ProxyJWTPayload {
  sub: string;  // Session UUID — dùng để lookup KV
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
  sub: string;           // Session UUID — dùng để issue refresh_token sau này
  client_id: string;
  redirect_uri: string;
}

/**
 * Refresh token record lưu trong KV — key: `refresh:{refreshTokenId}`
 * TTL trong KV: 90 ngày, được reset mỗi lần dùng (sliding window).
 */
export interface StoredRefreshTokenRecord {
  sub: string;           // Session UUID — liên kết với token:{sub}
  client_id: string;
  created_at: number;
  last_used_at: number;
}

export interface DCRClientRecord {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
  client_name: string;
  created_at: number;
}
