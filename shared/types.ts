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
  /** KV namespace binding — OAuth tokens, state, refresh records */
  OAUTH_KV: KVNamespace;
  /** KV namespace binding — shared formatting rules (jira:full, drawio:full, confluence:full).
   *  Optional: gracefully degrades if not bound (resources simply not registered). */
  MCP_RULES?: KVNamespace;
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
  /** Scope requested in this authorize attempt — used for fallback chain */
  requestedScope?: string;
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
  /** Actual scope granted by Atlassian DC — may be lower than requested if App Link ceiling is lower */
  grantedScope?: string;
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

// ── Phase 2: File content types ────────────────────────────────────────────────

/**
 * Where content is stored:
 *   attachment — Atlassian /child/attachment (any file)
 *   macro      — Inline Confluence Storage Format macro (mermaid, drawio)
 *   property   — Confluence content property key-value store
 *   proxy      — Binary: tool returns upload URL, client POSTs to Worker
 */
export type StorageMode = "auto" | "attachment" | "macro" | "property";

/**
 * How content appears in the page body after storage:
 *   none   — no page body change
 *   link   — insert <ri:attachment> text link
 *   inline — insert rendered macro or <ac:image> tag
 */
export type VisibilityMode = "auto" | "none" | "link" | "inline";

export interface ContentResult {
  action: "macro_embedded" | "attachment_created" | "property_set" | "proxy_upload_required";
  filename: string;
  size_bytes?: number;
  upload_endpoint?: string;
  curl_example?: string;
  attachment_id?: string;
  download_url?: string;
  version?: number;
  page_updated?: boolean;
  page_version?: number;
}

/** Hard limit enforced at the Worker proxy before forwarding to Atlassian. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB
