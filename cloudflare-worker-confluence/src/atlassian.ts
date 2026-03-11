/**
 * Confluence Data Center API client.
 * DC dùng instance URL trực tiếp — không có cloud_id.
 * API: ${confluenceUrl}/rest/api${path}
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
    throw new Error(`Confluence DC API error [${method} ${url}] → ${response.status}: ${errorDetail}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

/**
 * Gọi Confluence DC REST API.
 * URL format: ${confluenceUrl}/rest/api${path}
 * Ví dụ: confluenceRequest(token, "https://cms.pila.vn", "/content?spaceKey=DEV")
 */
export async function confluenceRequest(
  accessToken: string,
  confluenceUrl: string,
  path: string,
  method = "GET",
  body?: unknown
): Promise<unknown> {
  const base = `${confluenceUrl.replace(/\/$/, "")}/rest/api`;
  return atlassianFetch(`${base}${path}`, accessToken, method, body);
}
