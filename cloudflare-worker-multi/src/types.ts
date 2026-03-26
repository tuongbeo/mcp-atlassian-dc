/**
 * Multi-tenant Atlassian MCP Worker — Types
 *
 * Design:
 *   client_id format  : "{instanceUrl}||{atlassianAppLinkClientId}"
 *   client_secret     : Atlassian Application Link client secret
 *   serviceType       : inferred from URL path (/jira/mcp vs /confluence/mcp)
 *
 * KV key schema:
 *   state:{uuid}      → OAuthStateRecord      (TTL 10 min)
 *   code:{uuid}       → AuthCodeRecord         (TTL  5 min)
 *   token:{uuid}      → StoredTokenRecord      (TTL 90 days)
 *   refresh:{uuid}    → RefreshTokenRecord     (TTL 90 days, sliding)
 */

// ── Cloudflare Env ─────────────────────────────────────────────────────────────

export interface Env {
  /** Random hex: `openssl rand -hex 32` */
  JWT_SECRET: string;
  /** Public base URL, no trailing slash. E.g. https://atlassian.tuongbeo.workers.dev */
  PUBLIC_BASE_URL: string;
  /** KV namespace binding */
  OAUTH_KV: KVNamespace;
}

// ── Service type ───────────────────────────────────────────────────────────────

export type ServiceType = "jira" | "confluence";

// ── client_id parsing ──────────────────────────────────────────────────────────

export interface ParsedClientId {
  instanceUrl: string;
  atlassianClientId: string;
}

/**
 * Parse "{instanceUrl}||{atlassianClientId}" into its parts.
 * Returns null if the format is invalid.
 */
export function parseClientId(raw: string): ParsedClientId | null {
  const idx = raw.indexOf("||");
  if (idx < 0) return null;
  const instanceUrl = raw.slice(0, idx).trim();
  const atlassianClientId = raw.slice(idx + 2).trim();
  if (!instanceUrl.startsWith("http") || !atlassianClientId) return null;
  return { instanceUrl, atlassianClientId };
}

// ── KV record types ────────────────────────────────────────────────────────────

/** Stored after /authorize, before Atlassian callback — TTL 10 min */
export interface OAuthStateRecord {
  rawClientId: string;
  dcrRedirectUri: string;
  clientState: string;
  codeChallenge: string;
  serviceType: ServiceType;
}

/** Stored after /callback, consumed at /token — TTL 5 min */
export interface AuthCodeRecord {
  sub: string;
  rawClientId: string;
  dcrRedirectUri: string;
  clientState: string;
  codeChallenge: string;
  atlassianCode: string;
  serviceType: ServiceType;
}

/** Long-lived token record — TTL 90 days */
export interface StoredTokenRecord {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  oauth_token_url: string;
  /** AES-GCM encrypted: "{instanceUrl}||{atlassianClientId}" */
  enc_client_id: string;
  /** AES-GCM encrypted: Atlassian App Link client secret */
  enc_client_secret: string;
  serviceType: ServiceType;
}

/** Sliding-window refresh token record — TTL 90 days */
export interface RefreshTokenRecord {
  sub: string;
  rawClientId: string;
  created_at: number;
  last_used_at: number;
}

// ── Proxy JWT payload ──────────────────────────────────────────────────────────

export interface ProxyJWTPayload {
  sub: string;
  iat: number;
  exp: number;
}

// ── KV TTLs (seconds) ──────────────────────────────────────────────────────────

export const TTL = {
  STATE: 600,
  AUTH_CODE: 300,
  TOKEN: 90 * 86400,
  REFRESH: 90 * 86400,
  PROXY_JWT: 30 * 86400,
} as const;
