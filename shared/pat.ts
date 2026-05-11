/**
 * Auto PAT Lifecycle — shared/pat.ts
 *
 * Manages Personal Access Tokens for plugin API compatibility.
 * Confluence DC OAuth tokens work for core APIs but some 3rd-party plugins
 * use custom permission checks that only accept session-based auth or PATs.
 *
 * Flow:
 *   1. After OAuth, getOrCreatePAT() is called with the OAuth access token.
 *   2. PAT is created via POST /rest/pat/latest/tokens (core REST — OAuth compatible).
 *   3. rawToken + metadata stored in OAUTH_KV under `pat:{sub}`.
 *   4. On subsequent requests, PAT is loaded from KV (no network call if still valid).
 *   5. Auto-renew when < RENEW_THRESHOLD_DAYS remaining:
 *        revoke old PAT → create new → update KV.
 *   6. All failures are graceful — returns null so caller falls back to OAuth token.
 *
 * KV key: pat:{sub}  →  StoredPAT JSON  (KV TTL = PAT_EXPIRY_DAYS)
 */

import { Env } from "./types";

const PAT_NAME           = "claude-mcp-plugin";
const PAT_EXPIRY_DAYS    = 90;
const RENEW_THRESHOLD    = 7;   // days before expiry to trigger renewal
const KV_TTL             = PAT_EXPIRY_DAYS * 24 * 60 * 60; // seconds

interface StoredPAT {
  rawToken:   string;
  id:         number;
  expiringAt: string | null;  // ISO-8601 or null (no expiry)
  createdAt:  string;         // ISO-8601
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Returns a valid PAT for the given sub, creating/renewing as needed.
 * Returns null if PAT creation is not supported (graceful fallback to OAuth token).
 */
export async function getOrCreatePAT(
  sub: string,
  accessToken: string,
  instanceUrl: string,
  env: Env,
): Promise<string | null> {
  try {
    const kvKey = `pat:${sub}`;

    // 1. Check KV for cached PAT
    const stored = await env.OAUTH_KV.get<StoredPAT>(kvKey, "json");
    if (stored) {
      if (!needsRenewal(stored)) {
        return stored.rawToken;
      }
      // Expiring soon — revoke old, create new
      await revokePAT(accessToken, instanceUrl, stored.id).catch(() => {});
    } else {
      // No cached PAT — clean up any stale Confluence-side tokens first
      await cleanupStalePATs(accessToken, instanceUrl).catch(() => {});
    }

    // 2. Create new PAT
    return await createAndStorePAT(sub, accessToken, instanceUrl, env);
  } catch (e) {
    console.warn("[pat] getOrCreatePAT failed (graceful):", e);
    return null;
  }
}

/**
 * Force-refreshes PAT (e.g. after receiving 401 from a plugin API).
 * Revokes existing KV entry and creates a fresh PAT.
 */
export async function refreshPAT(
  sub: string,
  accessToken: string,
  instanceUrl: string,
  env: Env,
): Promise<string | null> {
  try {
    const kvKey = `pat:${sub}`;
    const stored = await env.OAUTH_KV.get<StoredPAT>(kvKey, "json");
    if (stored) {
      await revokePAT(accessToken, instanceUrl, stored.id).catch(() => {});
      await env.OAUTH_KV.delete(kvKey);
    }
    await cleanupStalePATs(accessToken, instanceUrl).catch(() => {});
    return await createAndStorePAT(sub, accessToken, instanceUrl, env);
  } catch (e) {
    console.warn("[pat] refreshPAT failed (graceful):", e);
    return null;
  }
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function needsRenewal(stored: StoredPAT): boolean {
  if (!stored.expiringAt) return false; // No expiry → never renew
  const expiresAt = new Date(stored.expiringAt).getTime();
  const daysLeft  = (expiresAt - Date.now()) / (1000 * 60 * 60 * 24);
  return daysLeft <= RENEW_THRESHOLD;
}

async function createAndStorePAT(
  sub: string,
  accessToken: string,
  instanceUrl: string,
  env: Env,
): Promise<string | null> {
  const base = instanceUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/rest/pat/latest/tokens`, {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type":  "application/json",
      "Accept":        "application/json",
    },
    body: JSON.stringify({
      name:               PAT_NAME,
      expirationDuration: PAT_EXPIRY_DAYS,
    }),
  });

  if (!res.ok) {
    console.warn(`[pat] Create PAT failed: ${res.status}`);
    return null;
  }

  const data = await res.json() as {
    id: number; rawToken: string; expiringAt?: string; createdAt?: string;
  };

  if (!data.rawToken) return null;

  const stored: StoredPAT = {
    rawToken:   data.rawToken,
    id:         data.id,
    expiringAt: data.expiringAt ?? null,
    createdAt:  new Date().toISOString(),
  };

  await env.OAUTH_KV.put(`pat:${sub}`, JSON.stringify(stored), { expirationTtl: KV_TTL });
  console.log(`[pat] Created PAT id=${data.id} for sub=${sub.slice(-8)}, expires=${stored.expiringAt}`);
  return data.rawToken;
}

async function revokePAT(
  accessToken: string,
  instanceUrl: string,
  patId: number,
): Promise<void> {
  const base = instanceUrl.replace(/\/$/, "");
  await fetch(`${base}/rest/pat/latest/tokens/${patId}`, {
    method:  "DELETE",
    headers: { "Authorization": `Bearer ${accessToken}` },
  });
}

/**
 * List all PATs and revoke any named claude-mcp-plugin.
 * Called before creating a fresh PAT to avoid accumulation.
 */
async function cleanupStalePATs(
  accessToken: string,
  instanceUrl: string,
): Promise<void> {
  const base = instanceUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/rest/pat/latest/tokens`, {
    headers: { "Authorization": `Bearer ${accessToken}`, "Accept": "application/json" },
  });
  if (!res.ok) return;

  const tokens = await res.json() as Array<{ id: number; name: string }>;
  const stale  = tokens.filter(t => t.name === PAT_NAME);
  await Promise.allSettled(stale.map(t => revokePAT(accessToken, instanceUrl, t.id)));
  if (stale.length > 0) {
    console.log(`[pat] Cleaned up ${stale.length} stale PAT(s)`);
  }
}
