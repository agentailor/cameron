# @agentailor/mcp-disclosure

Progressive disclosure for MCP tools in a LangChain v1 (`createAgent`) agent. The model sees a
short list of capabilities and `load_tools`, and a tool's definition only once a search has loaded
it (or its first call to it) — and no server is connected until one of its tools is called.

Internal workspace package; ships TypeScript source. It depends on nothing in the app and on no
MCP client library: the caller supplies the servers with their catalog entries, and a
`resolveTool` that connects — usually through `McpConnectionPool` and an `McpSession` built over
the MCP client of its choice.

```ts
import { McpConnectionPool, mcpServerDisclosureMiddleware } from "@agentailor/mcp-disclosure";

const pool = new McpConnectionPool();

createAgent({
  model,
  tools: coreTools, // no MCP tools: the middleware shows stand-ins built from the catalog
  middleware: [
    mcpServerDisclosureMiddleware({
      servers,
      resolveTool: async (serverId, name) => {
        const session = await pool.session(serverId, versionOf(serverId), () => open(serverId));
        const tool = session.getTool(name);
        return tool ? { ok: true, tool } : { ok: false, error: "unknown_tool", message: name };
      },
    }),
  ],
});
```

- `types.ts` — catalog entry, server, options + defaults, `McpSession`, `ResolveMcpTool`
- `catalog.ts` — normalize/hash `tools/list`, summaries, `refreshServerCatalog`
- `catalogTools.ts` — stand-in tools from the catalog, schemas unchanged
- `pool.ts` — `McpConnectionPool`: shared, versioned, idle-closing sessions
- `policy.ts` — pure decisions: capability list text, tool → server
- `search.ts` — BM25 over the catalog
- `middleware.ts` — the middleware, its state schema, `load_tools`

Design and options: [docs/MCP_DISCLOSURE.md](../../docs/MCP_DISCLOSURE.md).
