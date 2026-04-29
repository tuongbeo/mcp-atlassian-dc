/**
 * MCP Resources — Formatting rules served from Cloudflare KV.
 *
 * Rules are stored in a shared KV namespace "MCP_RULES" with prefix-based keys:
 *   jira:full       — Jira Wiki Markup rules (CR + SC + HP + checklist)
 *   drawio:full     — Draw.io mxGraph XML rules
 *   confluence:full — Confluence Storage Format rules
 *
 * Both Jira and Confluence Workers bind the same KV namespace.
 * Update rules without redeploying:
 *   wrangler kv key put --binding=MCP_RULES "jira:full" --path=./rules/jira-wiki-markup.md --remote
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ServiceType } from "./types";

// ── Resource definitions ──────────────────────────────────────────────────────

interface ResourceDef {
  name: string;
  uri: string;
  kvKey: string;
  description: string;
  mimeType: string;
}

const JIRA_RESOURCES: ResourceDef[] = [
  {
    name: "jira-formatting-guide",
    uri: "rules://jira/full",
    kvKey: "jira:full",
    description:
      "Jira Wiki Markup formatting rules for jira.pila.vn (Jira Server/DC). " +
      "Contains CR (common rules), SC (special cases by issue type), " +
      "HP (hard prohibitions), and pre-submit checklist. " +
      "READ THIS before writing any Jira description field.",
    mimeType: "text/markdown",
  },
];

const CONFLUENCE_RESOURCES: ResourceDef[] = [
  {
    name: "drawio-mxgraph-guide",
    uri: "rules://drawio/full",
    kvKey: "drawio:full",
    description:
      "Draw.io mxGraph XML generation rules. " +
      "Contains CR (XML structure, node styles, geometry), " +
      "SC (swimlane vs mini-flowchart, Confluence embed), " +
      "HP (dangling edges, wrong parents), and validation checklist. " +
      "READ THIS before generating any draw.io diagram XML.",
    mimeType: "text/markdown",
  },
  {
    name: "confluence-storage-guide",
    uri: "rules://confluence/full",
    kvKey: "confluence:full",
    description:
      "Confluence Storage Format (XHTML) rules for cms.pila.vn. " +
      "Contains CR (macros, mentions, dates, tables), " +
      "SC (meeting pages, draw.io embeds, code blocks), " +
      "HP (no wiki markup in storage, XML escaping), and checklist. " +
      "READ THIS before writing Confluence page content via API.",
    mimeType: "text/markdown",
  },
];

// ── Registration ──────────────────────────────────────────────────────────────

/**
 * Register MCP resources backed by Cloudflare KV.
 * Gracefully skips if KV binding is not available.
 */
export function registerFormattingResources(
  server: McpServer,
  serviceType: ServiceType,
  kv: KVNamespace | undefined
): void {
  if (!kv) return; // MCP_RULES not bound — skip silently

  const defs = serviceType === "jira" ? JIRA_RESOURCES : CONFLUENCE_RESOURCES;

  for (const res of defs) {
    server.resource(
      res.name,
      res.uri,
      { description: res.description, mimeType: res.mimeType },
      async () => {
        const text = await kv.get(res.kvKey);
        if (!text) {
          return {
            contents: [{
              uri: res.uri,
              mimeType: "text/plain",
              text: `[Rule set "${res.kvKey}" not found in KV. Upload with: wrangler kv key put --binding=MCP_RULES "${res.kvKey}" --path=./rules/FILE.md]`,
            }],
          };
        }
        return {
          contents: [{ uri: res.uri, mimeType: res.mimeType, text }],
        };
      }
    );
  }
}

// ── Tool description suffixes ─────────────────────────────────────────────────

export const JIRA_DESCRIPTION_SUFFIX =
  "\n\nFORMATTING (jira.pila.vn — Jira Server/DC Wiki Markup):\n" +
  "Before writing the description field, call resources/read uri=\"rules://jira/full\".\n" +
  "Quick fallback if resource unavailable:\n" +
  "• {panel:title=...|borderColor=...|bgColor=#ffffff} ONLY — NOT {info}/{note}/{warning}\n" +
  "• *bold* NOT **bold** · {{monospace}} NOT backtick · [text|url] NOT [text](url)\n" +
  "• Escape {variable} as {{variable}} · No emoji → use (/) (x) (!) (i)\n" +
  "• Lists: * item, nested: ** item (NOT - dash)";

export const DRAWIO_DESCRIPTION_SUFFIX =
  "\n\nFORMATTING (draw.io mxGraph XML):\n" +
  "Before generating XML, call resources/read uri=\"rules://drawio/full\".\n" +
  "Quick fallback: declare all nodes BEFORE edges, cross-lane edges parent=pool container id, " +
  "pool width = (lanes × 200) + 20.";

export const CONFLUENCE_DESCRIPTION_SUFFIX =
  "\n\nFORMATTING (Confluence Storage Format):\n" +
  "Before writing page content, call resources/read uri=\"rules://confluence/full\".\n" +
  "Quick fallback: use <ac:structured-macro> NOT {wiki-markup}, " +
  "user mentions via <ac:link><ri:user ri:userkey=\"...\"/></ac:link>, " +
  "dates via <time datetime=\"YYYY-MM-DD\" />.";
