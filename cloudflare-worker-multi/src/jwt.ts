/**
 * JWT helpers + Token Manager with auto-refresh.
 * Proxy JWT contains only `sub` (session UUID).
 * Actual Atlassian tokens live in KV under token:{sub}.
 */

import { Env, StoredTokenRecord, ProxyJWTPayload, TTL, parseClientId } from "./types";
import { decrypt, encrypt } from "./crypto";

// ── base64url helpers ─────────────────────────────────────────────────────────

function b64uEncode(data: string | ArrayBuffer): string {
  const str =
    typeof data === "string"
      ? data
      : String.fromCharCode(...new Uint8Array(data));
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function b64uDecode(s: string): string {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  return atob(pad ? padded + "=".repeat(4 - pad) : padded);
}

async function hmacKey(secret: string): Promise<CryptoKey> {
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
  expiresInSeconds = TTL.PROXY_JWT
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64uEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64uEncode(
    JSON.stringify({ ...payload, iat: now, exp: now + expiresInSeconds })
  );
  const key = await hmacKey(secret);
  const sig = b64uEncode(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${body}`))
  );
  return `${header}.${body}.${sig}`;
}

export async function verifyJWT(
  token: string,
  secret: string
): Promise<ProxyJWTPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const key = await hmacKey(secret);
  const expected = b64uEncode(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${body}`))
  );
  if (sig !== expected) return null;
  let payload: ProxyJWTPayload;
  try {
    payload = JSON.parse(b64uDecode(body)) as ProxyJWTPayload;
  } catch {
    return null;
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// ── Token manager ─────────────────────────────────────────────────────────────

const REFRESH_AHEAD_SECS = 5 * 60;

export async function getValidAccessToken(sub: string, env: Env): Promise<{ accessToken: string; record: StoredTokenRecord }> {
  const raw = await env.OAUTH_KV.get(`token:${sub}`, "text");
  if (!raw) throw new Error(`No token record for sub=${sub}`);
  const record: StoredTokenRecord = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);

  if (record.expires_at - now > REFRESH_AHEAD_SECS) return { accessToken: record.access_token, record };
  if (!record.refresh_token) throw new Error(`No refresh_token for sub=${sub}`);

  const rawClientId = await decrypt(record.enc_client_id, env.JWT_SECRET);
  const clientSecret = await decrypt(record.enc_client_secret, env.JWT_SECRET);
  if (!rawClientId || !clientSecret) throw new Error(`Decrypt failed for sub=${sub}`);

  const parsed = parseClientId(rawClientId);
  if (!parsed) throw new Error(`Invalid stored client_id for sub=${sub}`);

  const res = await fetch(record.oauth_token_url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: parsed.atlassianClientId,
      client_secret: clientSecret,
      refresh_token: record.refresh_token,
    }).toString(),
  });

  if (!res.ok) {
    await env.OAUTH_KV.delete(`token:${sub}`);
    throw new Error(`Token refresh failed (${res.status})`);
  }

  const tokens = (await res.json()) as {
    access_token: string; refresh_token?: string; expires_in?: number;
  };

  const updated: StoredTokenRecord = {
    ...record,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? record.refresh_token,
    expires_at: now + (tokens.expires_in ?? 3600),
  };

  await env.OAUTH_KV.put(`token:${sub}`, JSON.stringify(updated), { expirationTtl: TTL.TOKEN });
  return { accessToken: updated.access_token, record: updated };
}

export async function extractSub(request: Request, jwtSecret: string): Promise<string | null> {
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const payload = await verifyJWT(token, jwtSecret);
  return payload?.sub ?? null;
}
