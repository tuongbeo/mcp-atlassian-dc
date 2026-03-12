export interface Env {
  // ─── Atlassian OAuth 2.0 Application Link ────────────────────────────────
  ATLASSIAN_OAUTH_CLIENT_ID: string;
  ATLASSIAN_OAUTH_CLIENT_SECRET: string;
  ATLASSIAN_OAUTH_REDIRECT_URI: string;

  // ─── Atlassian Data Center Instance URLs ─────────────────────────────────
  JIRA_URL: string;        // https://jira.pila.vn
  OAUTH_BASE_URL: string;  // https://jira.pila.vn

  // ─── Worker config ────────────────────────────────────────────────────────
  PUBLIC_BASE_URL: string; // https://jira.pilacorp.workers.dev
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
