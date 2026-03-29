/**
 * Atlassian Data Center OAuth 2.0 — 2-phase exchange.
 *
 * /authorize  → redirect to Atlassian DC (no secret needed)
 * /callback   → store pending code in KV, redirect to Claude.ai
 * /token      → Claude.ai sends client_secret → exchange → proxy JWT
 *
 * DC vs Cloud: uses {instanceUrl}/rest/oauth2/latest/*, scope "READ WRITE",
 * form-encoded token exchange, no cloud_id.
 */

import {
  Env, ServiceType, OAuthStateRecord, AuthCodeRecord,
  StoredTokenRecord, RefreshTokenRecord, TTL, parseClientId
} from "./types";
import { signJWT } from "./jwt";
import { encrypt } from "./crypto";

const DC_SCOPES = "READ WRITE";
export const CALLBACK_PATH = "/callback";

// ── OAuth discovery ───────────────────────────────────────────────────────────

export function buildOAuthMetadata(serviceBase: string, sharedBase: string) {
  return {
    issuer: serviceBase,
    authorization_endpoint: `${serviceBase}/authorize`,
    token_endpoint: `${sharedBase}/token`,
    scopes_supported: ["READ", "WRITE"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
    code_challenge_methods_supported: ["S256"],
  };
}

export function buildResourceMetadata(serviceBase: string, mcpPath: string) {
  return {
    resource: `${serviceBase}${mcpPath}`,
    authorization_servers: [serviceBase],
    scopes_supported: ["READ", "WRITE"],
    bearer_methods_supported: ["header"],
  };
}

// ── GET /authorize ────────────────────────────────────────────────────────────

export async function handleAuthorize(
  request: Request, env: Env, serviceType: ServiceType
): Promise<Response> {
  const p = new URL(request.url).searchParams;
  const rawClientId   = p.get("client_id") ?? "";
  const redirectUri   = p.get("redirect_uri") ?? "";
  const state         = p.get("state") ?? crypto.randomUUID();
  const codeChallenge = p.get("code_challenge") ?? "";
  const method        = p.get("code_challenge_method") ?? "S256";

  if (!rawClientId)
    return errResp("invalid_request", "client_id required. Format: {instanceUrl}||{atlassianAppLinkClientId}");

  const parsed = parseClientId(rawClientId);
  if (!parsed)
    return errResp("invalid_request", "Invalid client_id. Expected: {instanceUrl}||{atlassianAppLinkClientId}");

  if (method !== "S256")
    return errResp("invalid_request", "Only code_challenge_method=S256 supported");

  await env.OAUTH_KV.put(
    `state:${state}`,
    JSON.stringify({ rawClientId, dcrRedirectUri: redirectUri, clientState: state, codeChallenge, serviceType } as OAuthStateRecord),
    { expirationTtl: TTL.STATE }
  );

  const authorizeUrl = `${parsed.instanceUrl.replace(/\/$/, "")}/rest/oauth2/latest/authorize`;
  const callbackUrl  = `${env.PUBLIC_BASE_URL}${CALLBACK_PATH}`;
  const dcParams = new URLSearchParams({
    client_id: parsed.atlassianClientId,
    scope: DC_SCOPES,
    redirect_uri: callbackUrl,
    state,
    response_type: "code",
  });
  return Response.redirect(`${authorizeUrl}?${dcParams}`, 302);
}

// ── GET /callback ─────────────────────────────────────────────────────────────

export async function handleCallback(request: Request, env: Env): Promise<Response> {
  const p = new URL(request.url).searchParams;
  const error = p.get("error");
  if (error) return new Response(
    `<html><body><h2>Authorization failed</h2><p>${p.get("error_description") ?? error}</p></body></html>`,
    { status: 400, headers: { "Content-Type": "text/html" } }
  );

  const atlassianCode = p.get("code");
  const state = p.get("state");
  if (!atlassianCode || !state) return new Response("Missing code or state", { status: 400 });

  const stateRecord = await env.OAUTH_KV.get<OAuthStateRecord>(`state:${state}`, "json");
  if (!stateRecord) return new Response("State expired. Please restart authorization.", { status: 400 });

  await env.OAUTH_KV.delete(`state:${state}`);

  const orgKey        = new URL(stateRecord.rawClientId.split("||")[0].trim()).hostname;
  const sub           = `${orgKey}:${crypto.randomUUID()}`;
  const proxyAuthCode = crypto.randomUUID();

  await env.OAUTH_KV.put(
    `code:${proxyAuthCode}`,
    JSON.stringify({
      sub, rawClientId: stateRecord.rawClientId,
      dcrRedirectUri: stateRecord.dcrRedirectUri,
      clientState: stateRecord.clientState,
      codeChallenge: stateRecord.codeChallenge,
      atlassianCode, serviceType: stateRecord.serviceType,
    } as AuthCodeRecord),
    { expirationTtl: TTL.AUTH_CODE }
  );

  const clientRedirect = new URL(stateRecord.dcrRedirectUri);
  clientRedirect.searchParams.set("code", proxyAuthCode);
  clientRedirect.searchParams.set("state", stateRecord.clientState);
  return Response.redirect(clientRedirect.toString(), 302);
}

// ── POST /token ───────────────────────────────────────────────────────────────

export async function handleToken(request: Request, env: Env): Promise<Response> {
  let body: Record<string, string> = {};
  const ct = request.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) body = await request.json() as Record<string, string>;
    else { const f = await request.formData(); f.forEach((v, k) => { body[k] = v.toString(); }); }
  } catch { return tokenErr("invalid_request", "Failed to parse body"); }

  const { grant_type, code, client_id: rawClientId, client_secret, code_verifier, refresh_token } = body;

  if (grant_type === "refresh_token") return handleRefreshGrant(refresh_token, rawClientId, env);
  if (grant_type !== "authorization_code") return tokenErr("unsupported_grant_type", `Unknown: ${grant_type}`);
  if (!code)          return tokenErr("invalid_request", "Missing code");
  if (!rawClientId)   return tokenErr("invalid_request", "Missing client_id");
  if (!client_secret) return tokenErr("invalid_request", "Missing client_secret (Atlassian App Link secret)");
  if (!code_verifier) return tokenErr("invalid_request", "Missing code_verifier (PKCE required)");

  const rec = await env.OAUTH_KV.get<AuthCodeRecord>(`code:${code}`, "json");
  if (!rec) return tokenErr("invalid_grant", "Code expired or invalid");
  if (rec.rawClientId !== rawClientId) return tokenErr("invalid_client", "client_id mismatch");

  if (rec.codeChallenge) {
    const hash = await sha256B64url(code_verifier);
    if (hash !== rec.codeChallenge) return tokenErr("invalid_grant", "PKCE code_verifier mismatch");
  }
  await env.OAUTH_KV.delete(`code:${code}`);

  const parsed = parseClientId(rawClientId);
  if (!parsed) return tokenErr("invalid_client", "Invalid client_id format");

  const tokenUrl    = `${parsed.instanceUrl.replace(/\/$/, "")}/rest/oauth2/latest/token`;
  const callbackUrl = `${env.PUBLIC_BASE_URL}${CALLBACK_PATH}`;

  const dcRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: parsed.atlassianClientId,
      client_secret, code: rec.atlassianCode, redirect_uri: callbackUrl,
    }).toString(),
  });

  if (!dcRes.ok) {
    const errText = await dcRes.text();
    console.error(`[token] Atlassian exchange failed (${dcRes.status}): ${errText}`);
    return tokenErr("invalid_grant", `Atlassian token exchange failed: ${dcRes.status}`);
  }

  const atlTokens = await dcRes.json() as {
    access_token: string; refresh_token?: string; expires_in?: number;
  };

  const [encClientId, encClientSecret] = await Promise.all([
    encrypt(rawClientId, env.JWT_SECRET),
    encrypt(client_secret, env.JWT_SECRET),
  ]);

  const now = Math.floor(Date.now() / 1000);
  await env.OAUTH_KV.put(`token:${rec.sub}`, JSON.stringify({
    access_token: atlTokens.access_token,
    refresh_token: atlTokens.refresh_token ?? "",
    expires_at: now + (atlTokens.expires_in ?? 3600),
    oauth_token_url: tokenUrl,
    enc_client_id: encClientId,
    enc_client_secret: encClientSecret,
    serviceType: rec.serviceType,
  } as StoredTokenRecord), { expirationTtl: TTL.TOKEN });

  const proxyRefreshToken = crypto.randomUUID();
  await env.OAUTH_KV.put(`refresh:${proxyRefreshToken}`, JSON.stringify({
    sub: rec.sub, rawClientId, created_at: now, last_used_at: now,
  } as RefreshTokenRecord), { expirationTtl: TTL.REFRESH });

  const proxyJWT = await signJWT({ sub: rec.sub }, env.JWT_SECRET, TTL.PROXY_JWT);
  return Response.json({ access_token: proxyJWT, token_type: "bearer", expires_in: TTL.PROXY_JWT, refresh_token: proxyRefreshToken });
}

// ── refresh_token grant ───────────────────────────────────────────────────────

async function handleRefreshGrant(
  refreshToken: string | undefined, rawClientId: string | undefined, env: Env
): Promise<Response> {
  if (!refreshToken) return tokenErr("invalid_request", "Missing refresh_token");
  const rec = await env.OAUTH_KV.get<RefreshTokenRecord>(`refresh:${refreshToken}`, "json");
  if (!rec) return tokenErr("invalid_grant", "Refresh token expired or invalid");
  if (rawClientId && rec.rawClientId !== rawClientId) return tokenErr("invalid_client", "client_id mismatch");

  const tokenExists = await env.OAUTH_KV.get(`token:${rec.sub}`, "text");
  if (!tokenExists) {
    await env.OAUTH_KV.delete(`refresh:${refreshToken}`);
    return tokenErr("invalid_grant", "Session expired. Please re-authorize.");
  }

  const now = Math.floor(Date.now() / 1000);
  await env.OAUTH_KV.put(`refresh:${refreshToken}`,
    JSON.stringify({ ...rec, last_used_at: now }),
    { expirationTtl: TTL.REFRESH }
  );

  const proxyJWT = await signJWT({ sub: rec.sub }, env.JWT_SECRET, TTL.PROXY_JWT);
  return Response.json({ access_token: proxyJWT, token_type: "bearer", expires_in: TTL.PROXY_JWT, refresh_token: refreshToken });
}

// ── helpers ───────────────────────────────────────────────────────────────────

function errResp(error: string, desc: string): Response {
  return Response.json({ error, error_description: desc }, { status: 400 });
}

function tokenErr(error: string, desc: string): Response {
  return Response.json({ error, error_description: desc },
    { status: error === "invalid_client" ? 401 : 400 });
}

async function sha256B64url(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
