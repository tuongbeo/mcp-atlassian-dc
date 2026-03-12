/**
 * Confluence Data Center API client với debug logging.
 */

async function atlassianFetch(
  url: string,
  accessToken: string,
  method = "GET",
  body?: unknown
): Promise<unknown> {
  console.log(`[Confluence DC] ${method} ${url}`);
  console.log(`[Confluence DC] Token prefix: ${accessToken.substring(0, 20)}...`);

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  console.log(`[Confluence DC] Response status: ${response.status}`);

  if (!response.ok) {
    let errorDetail = "";
    try { errorDetail = await response.text(); } catch { errorDetail = `HTTP ${response.status}`; }
    console.error(`[Confluence DC] Error body: ${errorDetail.substring(0, 500)}`);
    throw new Error(`Confluence DC API error [${method} ${url}] → ${response.status}: ${errorDetail}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

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
