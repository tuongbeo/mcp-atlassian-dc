/**
 * AES-GCM encryption helpers using WebCrypto (Cloudflare Workers native).
 * Encrypts Atlassian Application Link credentials before storing in KV.
 * Key derived from JWT_SECRET via SHA-256 — no extra secret needed.
 */

async function deriveKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret)
  );
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function toBase64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function fromBase64url(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  const b64 = pad ? padded + "=".repeat(4 - pad) : padded;
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Encrypt plaintext → base64url(iv).base64url(ciphertext) */
export async function encrypt(plain: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plain)
  );
  return `${toBase64url(iv.buffer)}.${toBase64url(ciphertext)}`;
}

/** Decrypt — returns null on any failure (wrong key, tampered data) */
export async function decrypt(
  encrypted: string,
  secret: string
): Promise<string | null> {
  try {
    const [ivB64, ctB64] = encrypted.split(".");
    if (!ivB64 || !ctB64) return null;
    const key = await deriveKey(secret);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64url(ivB64) },
      key,
      fromBase64url(ctB64)
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
