/**
 * JWT helper + Token Manager với auto-refresh.
 * - Proxy JWT chỉ chứa `sub` (session UUID) — tokens thực lưu trong KV
 * - getValidAccessToken() tự động refresh khi access_token còn < 5 phút
 */

import { Env, StoredTokenRecord } from "./types";

// ── Base64url helpers ─────────────────────────────────────────────────────────

function base64urlEncode(data: string | ArrayBuffer): string {
  const str = typeof data === "string"
    ? data
    : String.fromCharCode(...new Uint8Array(data));
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64urlDecode(str: string): string {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const padding = padded.length % 4;
  return atob(padding ? padded + "=".repeat(4 - padding) : padded);
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

// ── JWT sign / verify ─────────────────────────────────────────────────────────

export async function signJWT(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSeconds = 2592000  // 30 ngày mặc định
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64urlEncode(
    JSON.stringify({ ...payload, iat: now, exp: now + expiresInSeconds })
  );
  const key = await importHmacKey(secret);
  const sig = base64urlEncode(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${body}`))
  );
  return `${header}.${body}.${sig}`;
}

export async function verifyJWT(
  token: string,
  secret: string
): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;

  const key = await importHmacKey(secret);
  const expectedSig = base64urlEncode(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${body}`))
  );
  if (sig !== expectedSig) return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(base64urlDecode(body));
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < now) return null;

  return payload;
}

// ── Token Manager — lưu/đọc/refresh từ KV ────────────────────────────────────

const KV_TOKEN_PREFIX = "token:";
const KV_TOKEN_TTL = 90 * 24 * 3600;  // 90 ngày — xấp xỉ refresh token lifetime Atlassian DC
const REFRESH_THRESHOLD = 5 * 60;     // Refresh sớm nếu còn < 5 phút

/**
 * Lưu token record vào KV sau khi OAuth callback thành công.
 */
export async function storeTokens(
  sub: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  oauthBaseUrl: string,
  kv: KVNamespace
): Promise<void> {
  const record: StoredTokenRecord = {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    oauth_base_url: oauthBaseUrl,
  };
  await kv.put(`${KV_TOKEN_PREFIX}${sub}`, JSON.stringify(record), {
    expirationTtl: KV_TOKEN_TTL,
  });
  console.log(`[TokenManager] Stored tokens for sub=${sub}, expires_in=${expiresIn}s`);
}

/**
 * Lấy access token hợp lệ — tự động refresh nếu gần hết hạn.
 * Throws nếu không tìm thấy record hoặc refresh thất bại.
 */
export async function getValidAccessToken(
  sub: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  kv: KVNamespace
): Promise<string> {
  const record = await kv.get<StoredTokenRecord>(`${KV_TOKEN_PREFIX}${sub}`, "json");

  if (!record) {
    throw new Error(`No token found for sub=${sub}. User must re-authenticate.`);
  }

  const now = Math.floor(Date.now() / 1000);
  const needsRefresh = record.expires_at - now < REFRESH_THRESHOLD;

  if (!needsRefresh) {
    console.log(`[TokenManager] Access token valid for sub=${sub}, expires in ${record.expires_at - now}s`);
    return record.access_token;
  }

  // ── Refresh flow ──
  if (!record.refresh_token) {
    throw new Error(`Access token expired and no refresh token for sub=${sub}. User must re-authenticate.`);
  }

  console.log(`[TokenManager] Refreshing token for sub=${sub}...`);

  const tokenUrl = `${record.oauth_base_url.replace(/\/$/, "")}/rest/oauth2/latest/token`;
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: record.refresh_token,
      redirect_uri: redirectUri,
    }).toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`[TokenManager] Refresh failed for sub=${sub}: ${err}`);
    // Xóa record hết hạn khỏi KV để tránh retry vô ích
    await kv.delete(`${KV_TOKEN_PREFIX}${sub}`);
    throw new Error(`Token refresh failed (${res.status}). User must re-authenticate.`);
  }

  const newTokens = await res.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const updated: StoredTokenRecord = {
    access_token: newTokens.access_token,
    refresh_token: newTokens.refresh_token || record.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (newTokens.expires_in || 3600),
    oauth_base_url: record.oauth_base_url,
  };

  await kv.put(`${KV_TOKEN_PREFIX}${sub}`, JSON.stringify(updated), {
    expirationTtl: KV_TOKEN_TTL,
  });

  console.log(`[TokenManager] Token refreshed successfully for sub=${sub}`);
  return updated.access_token;
}

// ── Extract sub từ proxy JWT trong request header ─────────────────────────────

export async function extractSub(
  request: Request,
  jwtSecret: string
): Promise<string | null> {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const payload = await verifyJWT(token, jwtSecret);
  if (!payload) return null;

  return (payload.sub as string) || null;
}
