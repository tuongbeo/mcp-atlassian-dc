/**
 * Atlassian API clients cho Jira và Confluence.
 * Hỗ trợ cả Cloud (qua api.atlassian.com) và Data Center (direct URL).
 */

// ── Base fetch helper ────────────────────────────────────────────────────────

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
    try {
      errorDetail = await response.text();
    } catch {
      errorDetail = `HTTP ${response.status}`;
    }
    throw new Error(
      `Atlassian API error [${method} ${url}] → ${response.status}: ${errorDetail}`
    );
  }

  // 204 No Content
  if (response.status === 204) return null;

  return response.json();
}

// ── Jira API ─────────────────────────────────────────────────────────────────

function getJiraBaseUrl(cloudId: string, directUrl: string): string {
  if (cloudId && !directUrl.includes("localhost")) {
    // Atlassian Cloud
    return `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`;
  }
  // Data Center / Server
  return `${directUrl}/rest/api/2`;
}

export async function jiraRequest(
  accessToken: string,
  cloudId: string,
  jiraUrl: string,
  path: string,
  method = "GET",
  body?: unknown
): Promise<unknown> {
  const base = getJiraBaseUrl(cloudId, jiraUrl);
  return atlassianFetch(`${base}${path}`, accessToken, method, body);
}

// ── Confluence API ────────────────────────────────────────────────────────────

function getConfluenceBaseUrl(cloudId: string, directUrl: string): string {
  if (cloudId && !directUrl.includes("localhost")) {
    // Atlassian Cloud
    return `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/rest/api`;
  }
  // Data Center / Server
  return `${directUrl}/rest/api`;
}

export async function confluenceRequest(
  accessToken: string,
  cloudId: string,
  confluenceUrl: string,
  path: string,
  method = "GET",
  body?: unknown
): Promise<unknown> {
  const base = getConfluenceBaseUrl(cloudId, confluenceUrl);
  return atlassianFetch(`${base}${path}`, accessToken, method, body);
}
