/**
 * OAuth 2.0 Proxy cho MCP Atlassian Worker.
 *
 * Flow:
 * 1. Claude.ai hit /mcp → 401 + WWW-Authenticate
 * 2. Discover /.well-known/oauth-authorization-server
 * 3. POST /register (Dynamic Client Registration)
 * 4. GET /authorize → redirect sang Atlassian
 * 5. User đồng ý trên Atlassian → GET /callback
 * 6. Worker đổi code → Atlassian tokens → issue proxy JWT
 * 7. POST /token → trả proxy JWT cho client
 * 8. Client gọi /mcp với Bearer <proxy JWT>
 */

import { Env, OAuthStateRecord, AuthCodeRecord, DCRClientRecord } from "./types";
import { signJWT } from "./jwt";

const ATLASSIAN_AUTH_URL = "https://auth.atlassian.com/authorize";
const ATLASSIAN_TOKEN_URL = "https://auth.atlassian.com/oauth/token";
const ATLASSIAN_RESOURCES_URL =
  "https://api.atlassian.com/oauth/token/accessible-resources";

// Scopes cần thiết cho Jira + Confluence đầy đủ
const ATLASSIAN_SCOPES = [
  "read:jira-work",
  "write:jira-work",
  "read:jira-user",
  "read:confluence-space.summary",
  "read:confluence-content.summary",
  "read:confluence-content.all",
  "write:confluence-content",
  "search:confluence",
  "read:page:confluence",
  "offline_access", // bắt buộc để có refresh_token
].join(" ");

// ── OAuth Discovery Metadata ──────────────────────────────────────────────────

export function buildOAuthMetadata(baseUrl: string) {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    scopes_supported: ["read", "write"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
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
    scopes_supported: ["read", "write"],
    bearer_methods_supported: ["header"],
  };
}

// ── POST /register — Dynamic Client Registration (DCR) ───────────────────────

export async function handleDCR(
  request: Request,
  env: Env
): Promise<Response> {
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

  // Lưu client 7 ngày
  await env.OAUTH_KV.put(`client:${clientId}`, JSON.stringify(record), {
    expirationTtl: 604800,
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

// ── GET /authorize — Bắt đầu OAuth, redirect sang Atlassian ──────────────────

export async function handleAuthorize(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const params = url.searchParams;

  const clientId = params.get("client_id") || "";
  const redirectUri = params.get("redirect_uri") || "";
  const state = params.get("state") || crypto.randomUUID();
  const codeChallenge = params.get("code_challenge") || "";
  const codeChallengeMethod = params.get("code_challenge_method") || "S256";

  // Validate client tồn tại
  const clientRecord = await env.OAUTH_KV.get<DCRClientRecord>(
    `client:${clientId}`,
    "json"
  );
  if (!clientRecord) {
    return Response.json({ error: "invalid_client" }, { status: 400 });
  }

  // Lưu state để verify ở callback (TTL 10 phút)
  const stateRecord: OAuthStateRecord = {
    clientId,
    redirectUri,
    state,
    codeChallenge,
  };
  await env.OAUTH_KV.put(`oauth_state:${state}`, JSON.stringify(stateRecord), {
    expirationTtl: 600,
  });

  // Build URL sang Atlassian OAuth
  const atlassianParams = new URLSearchParams({
    audience: "api.atlassian.com",
    client_id: env.ATLASSIAN_OAUTH_CLIENT_ID,
    scope: ATLASSIAN_SCOPES,
    redirect_uri: env.ATLASSIAN_OAUTH_REDIRECT_URI,
    // Nhúng proxy state vào state của Atlassian
    state: JSON.stringify({ proxyState: state }),
    response_type: "code",
    prompt: "consent",
  });

  return Response.redirect(`${ATLASSIAN_AUTH_URL}?${atlassianParams}`, 302);
}

// ── GET /callback — Nhận code từ Atlassian, issue proxy JWT ──────────────────

export async function handleCallback(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const rawState = url.searchParams.get("state") || "{}";
  const error = url.searchParams.get("error");

  // Xử lý trường hợp user từ chối
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

  // Parse proxy state
  let proxyState = "";
  try {
    proxyState = (JSON.parse(rawState) as { proxyState?: string }).proxyState || "";
  } catch {
    return new Response("Invalid state parameter", { status: 400 });
  }

  // Lấy state record từ KV
  const stateRecord = await env.OAUTH_KV.get<OAuthStateRecord>(
    `oauth_state:${proxyState}`,
    "json"
  );
  if (!stateRecord) {
    return new Response(
      "OAuth state expired or invalid. Please restart the authorization flow.",
      { status: 400 }
    );
  }

  // Đổi code lấy Atlassian tokens
  const tokenResponse = await fetch(ATLASSIAN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: env.ATLASSIAN_OAUTH_CLIENT_ID,
      client_secret: env.ATLASSIAN_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: env.ATLASSIAN_OAUTH_REDIRECT_URI,
    }),
  });

  if (!tokenResponse.ok) {
    const errText = await tokenResponse.text();
    console.error("Atlassian token exchange failed:", errText);
    return new Response(`Token exchange failed: ${errText}`, { status: 502 });
  }

  const atlassianTokens = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type: string;
  };

  // Lấy cloud_id của Atlassian instance
  let cloudId = "";
  try {
    const resourcesResponse = await fetch(ATLASSIAN_RESOURCES_URL, {
      headers: {
        Authorization: `Bearer ${atlassianTokens.access_token}`,
      },
    });
    if (resourcesResponse.ok) {
      const resources = (await resourcesResponse.json()) as Array<{
        id: string;
        name: string;
      }>;
      cloudId = resources?.[0]?.id || "";
    }
  } catch (e) {
    console.error("Failed to fetch accessible resources:", e);
  }

  // Tạo proxy JWT — nhúng Atlassian token, không lưu file (stateless)
  const proxyJWT = await signJWT(
    {
      sub: cloudId || "unknown",
      atlassian_access_token: atlassianTokens.access_token,
      atlassian_refresh_token: atlassianTokens.refresh_token || "",
      cloud_id: cloudId,
    },
    env.JWT_SECRET,
    atlassianTokens.expires_in || 3600
  );

  // Lưu auth code tạm (5 phút) — client sẽ đổi lấy proxy JWT qua /token
  const authCode = crypto.randomUUID();
  const authCodeRecord: AuthCodeRecord = {
    proxy_jwt: proxyJWT,
    client_id: stateRecord.clientId,
    redirect_uri: stateRecord.redirectUri,
  };
  await env.OAUTH_KV.put(`auth_code:${authCode}`, JSON.stringify(authCodeRecord), {
    expirationTtl: 300,
  });

  // Xoá state đã dùng
  await env.OAUTH_KV.delete(`oauth_state:${proxyState}`);

  // Redirect về MCP client (Claude.ai)
  const clientRedirect = new URL(stateRecord.redirectUri);
  clientRedirect.searchParams.set("code", authCode);
  clientRedirect.searchParams.set("state", proxyState);

  return Response.redirect(clientRedirect.toString(), 302);
}

// ── POST /token — Đổi auth code lấy proxy JWT ────────────────────────────────

export async function handleToken(
  request: Request,
  env: Env
): Promise<Response> {
  let body: Record<string, string> = {};

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    body = (await request.json()) as Record<string, string>;
  } else if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const formData = await request.formData();
    formData.forEach((value, key) => {
      body[key] = value.toString();
    });
  }

  const { grant_type, code, client_id, client_secret } = body;

  if (grant_type !== "authorization_code") {
    return Response.json(
      { error: "unsupported_grant_type" },
      { status: 400 }
    );
  }

  if (!code) {
    return Response.json({ error: "invalid_request", error_description: "Missing code" }, { status: 400 });
  }

  // Lấy auth code record
  const authCodeRecord = await env.OAUTH_KV.get<AuthCodeRecord>(
    `auth_code:${code}`,
    "json"
  );
  if (!authCodeRecord) {
    return Response.json(
      { error: "invalid_grant", error_description: "Code expired or invalid" },
      { status: 400 }
    );
  }

  // Validate client nếu có gửi credentials
  if (client_id && authCodeRecord.client_id !== client_id) {
    return Response.json({ error: "invalid_client" }, { status: 401 });
  }

  // Xoá auth code sau khi dùng (one-time use)
  await env.OAUTH_KV.delete(`auth_code:${code}`);

  return Response.json({
    access_token: authCodeRecord.proxy_jwt,
    token_type: "bearer",
    expires_in: 3600,
  });
}
