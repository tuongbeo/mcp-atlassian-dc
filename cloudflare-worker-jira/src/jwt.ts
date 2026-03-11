/**
 * JWT helper — HMAC-SHA256 via Web Crypto API.
 * Không cần thư viện ngoài, chạy native trên Cloudflare Workers.
 */

function base64urlEncode(data: string | ArrayBuffer): string {
  let str: string;
  if (typeof data === "string") {
    str = data;
  } else {
    str = String.fromCharCode(...new Uint8Array(data));
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64urlDecode(str: string): string {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const padding = padded.length % 4;
  const padded2 = padding ? padded + "=".repeat(4 - padding) : padded;
  return atob(padded2);
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signJWT(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSeconds = 3600
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64urlEncode(
    JSON.stringify({ ...payload, iat: now, exp: now + expiresInSeconds })
  );
  const key = await importHmacKey(secret);
  const enc = new TextEncoder();
  const sigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${body}`));
  const sig = base64urlEncode(sigBuffer);
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
  const enc = new TextEncoder();
  const expectedSigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${body}`));
  const expectedSig = base64urlEncode(expectedSigBuffer);
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

/**
 * Lấy Atlassian access token từ Authorization Bearer header.
 * DC không dùng cloud_id — chỉ cần accessToken.
 */
export async function extractAtlassianCreds(
  request: Request,
  jwtSecret: string
): Promise<{ accessToken: string; refreshToken: string } | null> {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const payload = await verifyJWT(token, jwtSecret);
  if (!payload) return null;

  const accessToken = payload.atlassian_access_token as string;
  const refreshToken = (payload.atlassian_refresh_token as string) || "";

  if (!accessToken) return null;

  return { accessToken, refreshToken };
}
