/**
 * Jira Data Center API client.
 * DC dùng instance URL trực tiếp — không có cloud_id, không qua api.atlassian.com.
 * API version: /rest/api/2 (DC dùng v2, Cloud dùng v3)
 */

async function atlassianFetch(
  url: string,
  accessToken: string,
  method = "GET",
  body?: unknown
): Promise<unknown> {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let errorDetail = "";
    try { errorDetail = await response.text(); } catch { errorDetail = `HTTP ${response.status}`; }
    throw new Error(`Jira DC API error [${method} ${url}] → ${response.status}: ${errorDetail}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

/**
 * Gọi Jira DC REST API v2.
 * URL format: ${jiraUrl}/rest/api/2${path}
 * Ví dụ: jiraRequest(token, "https://jira.pila.vn", "/search?jql=project=ABC")
 */
export async function jiraRequest(
  accessToken: string,
  jiraUrl: string,
  path: string,
  method = "GET",
  body?: unknown
): Promise<unknown> {
  const base = `${jiraUrl.replace(/\/$/, "")}/rest/api/2`;
  return atlassianFetch(`${base}${path}`, accessToken, method, body);
}
