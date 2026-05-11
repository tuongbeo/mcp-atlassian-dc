/**
 * Atlassian DC API clients.
 * Jira:      {instanceUrl}/rest/api/2/...
 * Confluence: {instanceUrl}/rest/api/...
 */

async function atlassianFetch(
  url: string, accessToken: string, method = "GET", body?: unknown
): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    let detail = "";
    try { detail = await res.text(); } catch { detail = `HTTP ${res.status}`; }
    throw new Error(`Atlassian DC [${method} ${url}] → ${res.status}: ${detail.slice(0, 400)}`);
  }
  return res.json();
}

export function jiraRequest(
  accessToken: string, instanceUrl: string,
  path: string, method = "GET", body?: unknown
): Promise<unknown> {
  return atlassianFetch(
    `${instanceUrl.replace(/\/$/, "")}/rest/api/2${path}`,
    accessToken, method, body
  );
}

export function confluenceRequest(
  accessToken: string, instanceUrl: string,
  path: string, method = "GET", body?: unknown
): Promise<unknown> {
  // Paths starting with /experimental/ or /prototype/ bypass the /api/ segment
  // so they resolve to {instanceUrl}/rest/{path} instead of /rest/api/{path}.
  const bypassApi = path.startsWith("/experimental/") || path.startsWith("/prototype/");
  const base = bypassApi
    ? `${instanceUrl.replace(/\/$/, "")}/rest${path}`
    : `${instanceUrl.replace(/\/$/, "")}/rest/api${path}`;
  return atlassianFetch(base, accessToken, method, body);
}

/**
 * Multipart POST for Atlassian attachment uploads.
 * Does NOT set Content-Type — fetch auto-sets multipart/form-data + boundary.
 * Requires X-Atlassian-Token: no-check to bypass CSRF on Atlassian DC.
 */
export async function atlassianMultipartRequest(
  accessToken: string,
  url: string,
  formData: FormData
): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Atlassian-Token": "no-check",
      Accept: "application/json",
    },
    body: formData,
  });
  if (!res.ok) {
    let detail = "";
    try { detail = await res.text(); } catch { detail = `HTTP ${res.status}`; }
    throw new Error(`Atlassian multipart [POST ${url}] → ${res.status}: ${detail.slice(0, 400)}`);
  }
  return res.json();
}

// ── Generic REST proxy ─────────────────────────────────────────────────────────

export interface GenericRequestResult {
  status: number;
  status_text: string;
  headers: Record<string, string>;
  body: unknown;
  truncated?: boolean;
}

const RESPONSE_BODY_CAP = 50 * 1024; // 50 KB

/**
 * Generic Atlassian REST proxy — called by jira_rest / confluence_rest tools.
 * - `path` is absolute from the instance root (e.g. /rest/agile/1.0/board).
 * - Does NOT throw on non-2xx — returns full status so Claude can interpret errors.
 * - Response body truncated at 50 KB to protect context window.
 */
export async function atlassianGenericRequest(
  accessToken: string,
  instanceUrl: string,
  path: string,
  method: string,
  body?: string,
  contentType: "json" | "form" = "json",
  query?: Record<string, string>
): Promise<GenericRequestResult> {
  const base = instanceUrl.replace(/\/$/, "");
  const url = new URL(`${base}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
  if (body !== undefined) {
    headers["Content-Type"] =
      contentType === "form" ? "application/x-www-form-urlencoded" : "application/json";
  }
  if (method !== "GET") headers["X-Atlassian-Token"] = "no-check";

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body !== undefined ? body : undefined,
  });

  // Collect response headers (subset that are useful for debugging)
  const respHeaders: Record<string, string> = {};
  for (const key of ["content-type", "x-ausername", "x-seraph-loginrequired", "x-content-type-options"]) {
    const val = res.headers.get(key);
    if (val) respHeaders[key] = val;
  }

  const rawText = await res.text();
  let parsed: unknown = rawText;
  try { parsed = JSON.parse(rawText); } catch { /* keep raw text */ }

  const truncated = rawText.length > RESPONSE_BODY_CAP;
  if (truncated && typeof parsed === "string") {
    parsed = rawText.slice(0, RESPONSE_BODY_CAP) + `\n…[truncated — full response was ${rawText.length} bytes]`;
  }

  return {
    status: res.status,
    status_text: res.statusText,
    headers: respHeaders,
    body: parsed,
    ...(truncated ? { truncated: true } : {}),
  };
}

/**
 * Inserts Confluence Storage Format markup into a page body (append or prepend).
 * Returns the new version number after the update.
 */
export async function insertIntoPageBody(
  accessToken: string,
  instanceUrl: string,
  pageId: string,
  markup: string,
  position: "append" | "prepend" = "append"
): Promise<{ newVersion: number }> {
  const base = instanceUrl.replace(/\/$/, "");
  const page = await atlassianFetch(
    `${base}/rest/api/content/${pageId}?expand=body.storage,version,title,space`,
    accessToken
  ) as {
    version?: { number?: number };
    title?: string;
    space?: { key?: string };
    body?: { storage?: { value?: string } };
  };
  const existingBody = page.body?.storage?.value ?? "";
  const newBody = position === "prepend"
    ? markup + "\n" + existingBody
    : existingBody + "\n" + markup;
  const nextVersion = (page.version?.number ?? 1) + 1;
  await atlassianFetch(`${base}/rest/api/content/${pageId}`, accessToken, "PUT", {
    version: { number: nextVersion },
    title: page.title,
    type: "page",
    space: { key: page.space?.key },
    body: { storage: { value: newBody, representation: "storage" } },
  });
  return { newVersion: nextVersion };
}
