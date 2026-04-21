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
