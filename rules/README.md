# MCP Formatting Rules

Shared formatting rules stored in Cloudflare KV (`MCP_RULES` namespace).
Served as MCP Resources to Claude via `resources/read` protocol.

## Files

| File | KV Key | Used by |
|------|--------|---------|
| jira-wiki-markup.md | `jira:full` | Jira MCP Worker |
| drawio-mxgraph.md | `drawio:full` | Confluence MCP Worker |
| confluence-storage.md | `confluence:full` | Confluence MCP Worker |

## Upload to KV

```bash
wrangler kv key put --binding=MCP_RULES "jira:full"       --path=./rules/jira-wiki-markup.md --remote
wrangler kv key put --binding=MCP_RULES "drawio:full"     --path=./rules/drawio-mxgraph.md --remote
wrangler kv key put --binding=MCP_RULES "confluence:full" --path=./rules/confluence-storage.md --remote
```

## Update without redeploying

Same commands — KV update takes effect immediately.
