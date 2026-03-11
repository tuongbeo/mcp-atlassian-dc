export interface Env {
  // ─── Atlassian OAuth 2.0 Application Link (cấu hình trong Confluence Admin → Application Links) ──
  ATLASSIAN_OAUTH_CLIENT_ID: string;
  ATLASSIAN_OAUTH_CLIENT_SECRET: string;

  // URL callback — phải khớp với "Redirect URI" trong Application Link
  // Ví dụ: https://mcp-confluence.pilacorp.workers.dev/callback
  ATLASSIAN_OAUTH_REDIRECT_URI: string;

  // ─── Atlassian Data Center Instance URLs ─────────────────────────────────
  CONFLUENCE_URL: string;  // https://cms.pila.vn

  // OAuth server của Confluence DC — thường bằng CONFLUENCE_URL
  // Endpoint: ${OAUTH_BASE_URL}/rest/oauth2/latest/authorize|token
  OAUTH_BASE_URL: string;  // https://cms.pila.vn

  // ─── Worker config ────────────────────────────────────────────────────────
  PUBLIC_BASE_URL: string; // https://mcp-confluence.pilacorp.workers.dev
  JWT_SECRET: string;

  // ─── Cloudflare bindings ──────────────────────────────────────────────────
  OAUTH_KV: KVNamespace;
}

export interface ProxyJWTPayload {
  sub: string;
  atlassian_access_token: string;
  atlassian_refresh_token: string;
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
