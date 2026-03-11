/**
 * OAuth 2.0 Proxy cho Atlassian Data Center.
 *
 * DC OAuth khác Cloud:
 * - Endpoint: {INSTANCE_URL}/rest/oauth2/latest/authorize|token
 * - Không có audience, prompt=consent
 * - Scope đơn giản: READ WRITE
 * - Token exchange dùng form-encoded (không phải JSON)
 * - Không có cloud_id — API gọi thẳng vào instance URL
 *
 * Flow:
 * 1. Claude.ai → GET /mcp → 401 + WWW-Authenticate
 * 2. Discover /.well-known/oauth-authorization-server
 * 3. POST /register (Dynamic Client Registration)
 * 4. GET /authorize → redirect sang Atlassian DC instance
 * 5. User đồng ý → GET /callback
 * 6. Worker đổi code → DC tokens → issue proxy JWT
 * 7. POST /token → trả proxy JWT
 * 8. GET/POST /mcp với Bearer <proxy JWT>
 */

import { Env, OAuthStateRecord, AuthCodeRecord, DCRClientRecord } from "./types";
import { signJWT } from "./jwt";

// DC scopes — đơn giản, không phải Cloud granular scopes
const DC_SCOPES = "READ WRITE";

// ── OAuth Discovery Metadata ──────────────────────────────────────────────────

export function buildOAuthMetadata(baseUrl: string) {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    scopes_supported: ["READ", "WRITE"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      "client_secret_basic",
      "none",
    ],
    code_challenge_methods_supported: ["S256", "plain"],
  };
}

export function buildResourceMetadata(baseUrl: string) {
  return {
    resource: `${baseUrl}/mcp`,
    authorization_servers: [baseUrl],
    scopes_supported: ["READ", "WRITE"],
    bearer_methods_supported: ["header"],
  };
}

// ── POST /register — Dynamic Client Registration ─────────────────────────────

export async function handleDCR(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // body không bắt buộc
  }

  const clientId = crypto.randomUUID();
  const clientSecret = crypto.randomUUID();
  const redirectUris = (body.redirect_uris as string[]) || [];

  const record: DCRClientRecord = {
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uris: redirectUris,
    client_name: (body.client_name as string) || "MCP Client",
    created_at: Date.now(),
  };

  await env.OAUTH_KV.put(`client:${clientId}`, JSON.stringify(record), {
    expirationTtl: 604800, // 7 ngày
  });

  return Response.json(
    {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
      client_name: record.client_name,
    },
    { status: 201 }
  );
}

// ── GET /authorize — Redirect sang Atlassian DC instance ─────────────────────

export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const params = url.searchParams;

  const clientId = params.get("client_id") || "";
  const redirectUri = params.get("redirect_uri") || "";
  const state = params.get("state") || crypto.randomUUID();
  const codeChallenge = params.get("code_challenge") || "";

  const clientRecord = await env.OAUTH_KV.get<DCRClientRecord>(`client:${clientId}`, "json");
  if (!clientRecord) {
    return Response.json({ error: "invalid_client" }, { status: 400 });
  }

  const stateRecord: OAuthStateRecord = { clientId, redirectUri, state, codeChallenge };
  await env.OAUTH_KV.put(`oauth_state:${state}`, JSON.stringify(stateRecord), {
    expirationTtl: 600, // 10 phút
  });

  // DC OAuth authorize URL — KHÔNG có audience, KHÔNG có prompt
  const dcAuthorizeUrl = `${env.OAUTH_BASE_URL.replace(/\/$/, "")}/rest/oauth2/latest/authorize`;
  const atlassianParams = new URLSearchParams({
    client_id: env.ATLASSIAN_OAUTH_CLIENT_ID,
    scope: DC_SCOPES,
    redirect_uri: env.ATLASSIAN_OAUTH_REDIRECT_URI,
    state: state, // truyền thẳng, không wrap JSON (DC không chấp nhận dấu ")
    response_type: "code",
    // KHÔNG có: audience, prompt (chỉ dành cho Cloud)
  });

  return Response.redirect(`${dcAuthorizeUrl}?${atlassianParams}`, 302);
}

// ── GET /callback — Nhận code, đổi lấy token DC ──────────────────────────────

export async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const rawState = url.searchParams.get("state") || "";
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(
      `<html><body>
        <h2>Authorization denied</h2>
        <p>Error: ${error}</p>
        <p>${url.searchParams.get("error_description") || ""}</p>
      </body></html>`,
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  if (!code) {
    return new Response("Missing authorization code", { status: 400 });
  }

  // DC trả state trực tiếp (không wrap JSON)
  const proxyState = rawState;
  if (!proxyState) {
    return new Response("Invalid state parameter", { status: 400 });
  }

  const stateRecord = await env.OAUTH_KV.get<OAuthStateRecord>(`oauth_state:${proxyState}`, "json");
  if (!stateRecord) {
    return new Response(
      "OAuth state expired or invalid. Please restart the authorization flow.",
      { status: 400 }
    );
  }

  // DC token exchange — dùng application/x-www-form-urlencoded (KHÔNG phải JSON)
  const dcTokenUrl = `${env.OAUTH_BASE_URL.replace(/\/$/, "")}/rest/oauth2/latest/token`;
  const formBody = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: env.ATLASSIAN_OAUTH_CLIENT_ID,
    client_secret: env.ATLASSIAN_OAUTH_CLIENT_SECRET,
    code,
    redirect_uri: env.ATLASSIAN_OAUTH_REDIRECT_URI,
  });

  const tokenResponse = await fetch(dcTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody.toString(),
  });

  if (!tokenResponse.ok) {
    const errText = await tokenResponse.text();
    console.error("DC token exchange failed:", errText);
    return new Response(`Token exchange failed: ${errText}`, { status: 502 });
  }

  const dcTokens = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type: string;
  };

  // DC không cần cloud_id — chỉ lưu access_token + refresh_token vào proxy JWT
  const proxyJWT = await signJWT(
    {
      sub: "dc-user",
      atlassian_access_token: dcTokens.access_token,
      atlassian_refresh_token: dcTokens.refresh_token || "",
    },
    env.JWT_SECRET,
    dcTokens.expires_in || 3600
  );

  const authCode = crypto.randomUUID();
  const authCodeRecord: AuthCodeRecord = {
    proxy_jwt: proxyJWT,
    client_id: stateRecord.clientId,
    redirect_uri: stateRecord.redirectUri,
  };
  await env.OAUTH_KV.put(`auth_code:${authCode}`, JSON.stringify(authCodeRecord), {
    expirationTtl: 300, // 5 phút
  });

  await env.OAUTH_KV.delete(`oauth_state:${proxyState}`);

  const clientRedirect = new URL(stateRecord.redirectUri);
  clientRedirect.searchParams.set("code", authCode);
  clientRedirect.searchParams.set("state", proxyState);

  return Response.redirect(clientRedirect.toString(), 302);
}

// ── POST /token — Đổi auth code lấy proxy JWT ────────────────────────────────

export async function handleToken(request: Request, env: Env): Promise<Response> {
  let body: Record<string, string> = {};

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    body = (await request.json()) as Record<string, string>;
  } else {
    const formData = await request.formData();
    formData.forEach((value, key) => { body[key] = value.toString(); });
  }

  const { grant_type, code, client_id } = body;

  if (grant_type !== "authorization_code") {
    return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
  }

  if (!code) {
    return Response.json({ error: "invalid_request", error_description: "Missing code" }, { status: 400 });
  }

  const authCodeRecord = await env.OAUTH_KV.get<AuthCodeRecord>(`auth_code:${code}`, "json");
  if (!authCodeRecord) {
    return Response.json({ error: "invalid_grant", error_description: "Code expired or invalid" }, { status: 400 });
  }

  if (client_id && authCodeRecord.client_id !== client_id) {
    return Response.json({ error: "invalid_client" }, { status: 401 });
  }

  await env.OAUTH_KV.delete(`auth_code:${code}`);

  return Response.json({
    access_token: authCodeRecord.proxy_jwt,
    token_type: "bearer",
    expires_in: 3600,
  });
}
