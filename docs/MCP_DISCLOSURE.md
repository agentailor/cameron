# MCP progressive disclosure

Every enabled MCP server used to be connected (stdio servers spawned) and its tools bound to the
model on every request. Context grew with each server, tool selection got worse, and every server
cost a connection whether it was used or not. Progressive disclosure reduces both:

- **Context** — the model sees a short **list of capabilities** and `load_tools`. A tool's
  definition is sent only once a search has loaded it in the thread.
- **Connections** — nothing connects when the agent is built. A server is connected the first
  time one of its tools is **called**, then kept in a process-wide pool until idle.

The unit the model loads is the **tool**; sign-in, connections and the catalog stay per server. It
needs no configuration: there is no mode, and no per-tool or per-server setting.

The logic lives in the workspace package [`packages/mcp-disclosure`](../packages/mcp-disclosure)
(`@agentailor/mcp-disclosure`). It imports nothing from the app and **nothing from the MCP client
library** — only MCP protocol shapes (`tools/list`) and LangChain tool types. The app supplies:

| App file                   | Role                                                                  |
| -------------------------- | --------------------------------------------------------------------- |
| `src/lib/mcp/connector.ts` | The only agent-path file using `@langchain/mcp-adapters`: one session |
| `src/lib/mcp/pool.ts`      | The process-wide pool singleton and the middleware's `resolveTool`    |
| `src/lib/mcp/catalog.ts`   | Catalog refresh and loading, through the connector                    |
| `src/lib/agent/index.ts`   | Registers core tools only, plus the middleware                        |

Moving to another MCP client (the v2 adapters) means rewriting `connector.ts`; the catalog rows,
the pool and the middleware are unaffected. The Connections page's "list tools" probe
(`listServerTools`) still uses the adapter directly and is left for that migration.

## The flow

1. **Add a server** on the Connections page. If it needs OAuth, connect it. Its catalog row is
   written once it can be reached (on create, and again when OAuth completes).
2. **Every model call** sees the core tools, `load_tools`, previously loaded tools, and a list
   appended to the system prompt, sorted by name and byte-stable across turns:

   ```
   Additional capabilities are available. Call load_tools with a short description of what you need before using them.
   - bank: Read-only access to the user's checking and savings accounts
   - drive (sign-in required): Read and search the user's files
   ```

3. **The model calls `load_tools({ query })`**, with no connection made. The best matches (5 by
   default) are added to the end of `tools` from the next step on, for the rest of the thread.
4. **The model calls a tool**; its server is connected then, through the pool.

With no server available, neither `load_tools` nor the list is added.

## `load_tools`

```ts
load_tools({ query: string; server?: string; limit?: number }); // limit defaults to 5, capped at 10
```

```jsonc
// Definitions arrive through `tools`; the result carries names and short descriptions only.
{ "ok": true, "loaded": [{ "name": "notionApi__API-post-search", "description": "…" }],
  "alreadyLoaded": [], "matched": 7 }

// No match is a correctable result: search again, or with an exact name.
{ "ok": true, "loaded": [], "matched": 0, "hint": "…", "toolNames": { "notionApi": ["…"] } }
```

- `query` may be an exact tool name, prefixed or not, which loads only that tool.
- `server` limits the search to one capability; an unknown one returns `unknown_server` with the
  valid names.
- **Search** is BM25 over the cached catalog (`search.ts`), built once per agent. Indexed, most
  weight first: tool name, description and argument names, argument descriptions and server name.
  The tokenizer splits on case and punctuation, so `API-post-search` matches "search", and folds
  plurals. Ties break by name, so a query always gives the same result.

**Why `tools` and not tool results.** A schema in a tool result saves nothing, since history is
re-sent, and it can never be removed; it also loses real tool names and `tool_choice`.

**Why nothing is removed.** Changing the tool list costs a prompt-cache miss, so loaded tools stay
for the thread and `activeTools` keeps load order, leaving the existing array as a stable prefix.
Each load still costs one miss on that prefix: measure it with the cache attributes in
[OBSERVABILITY.md](OBSERVABILITY.md). A thread only grows by tools the model asked for.

## Servers that need sign-in

A server needs the user when it is an OAuth server whose status is `REQUIRED` or `EXPIRED`
(`needsAuth()` in `connector.ts`). That is known from stored state, without connecting.

- **Never authorized** — it has no catalog row (listing its tools needs a connection), so the
  model is not told about it until the user connects it.
- **Authorized once, now expired** — its row still exists. Its line says `sign-in required`, and
  `load_tools` never loads its tools. When only it matches, the result is:

  ```json
  {
    "ok": false,
    "error": "auth_required",
    "server": "drive",
    "message": "drive needs to be reconnected before its tools can be used. Ask the user to reconnect it on the Connections page, then try again."
  }
  ```

  When other servers match too, their tools load and `signInRequired` names it.

- **Expires mid-thread** — a tool call gets the same `auth_required` result.

The user reconnects on the Connections page and asks again. Resuming the run in place (an
interrupt carrying the authorization URL, with a Connect button in the chat) is deferred.

## Tools without connections

No MCP tool is registered with `createAgent`. Instead:

1. **Stand-ins from the catalog.** `catalogTools()` builds one tool per cached entry
   (`server__tool`, its description, and its `inputSchema` exactly as the server listed it). `wrapModelCall` adds the loaded stand-ins to `request.tools` —
   LangChain accepts tools added there as long as a `wrapToolCall` runs them. A stand-in throws if it is ever run directly.
2. **The real tool on call.** `wrapToolCall` asks `resolveTool(serverId, toolName)` for the real
   tool and passes it on as `request.tool`, which the tool node runs; result formatting stays the
   client library's. A tool the catalog does not list is refused (`unknown_tool`) without
   connecting. A connection failure comes back as an error result (`connect_failed`,
   `auth_required`, `timeout`) and does not load the tool.
3. **Auto-load.** A call to a catalog tool that was not loaded still runs it and loads it
   (`autoLoadOnCall`), which only happens when the model guesses a name.

**MCP schemas are never converted.** Cameron sends each one as the server listed it, whatever the
provider: stripping `anyOf` once left the model an empty schema for Notion's `parent`, so it could
only guess. A provider that rejects a schema (Gemini is the likely one) fails that model call, and
every later call in the thread, because nothing is removed; a new thread is unaffected. The real
tool still validates against the MCP client library's own converted schema, which can be looser or
stricter than what the model saw.

## Connection pool

`McpConnectionPool` (package) keeps one `McpSession` per server, process-wide (on `globalThis`, so
dev hot reload doesn't leak child processes):

- **Keyed by server id + version.** The app uses the row's `updatedAt` as the version, so any
  edit (or token write) reconnects on the next call instead of reusing stale settings.
- **Shared first connection.** Parallel calls to a server that is still connecting wait for the
  same connection.
- **Idle close** after `DEFAULT_IDLE_MS` (5 minutes, a code constant); each call restarts the
  clock. The timer is `unref`'d so it never keeps the process alive.
- **Dropped** when a connection fails, when it closes on its own (a stdio process exits), and
  explicitly (`invalidate`) when a server is disabled, edited or deleted, or OAuth completes.

When the pool opens a session it compares the live `tools/list` hash with the catalog's; if they
differ, it rewrites the catalog row from that same session (no second connection).

Measured on the dev stack with three fake stdio servers, each logging its spawn:

| Run                                           | Spawns               |
| --------------------------------------------- | -------------------- |
| Bank question (2 bank calls)                  | bank ×1              |
| Same thread, weather question (1 call)        | weather ×1           |
| New thread, no tool use                       | none                 |
| Same thread, later request calling bank again | none (pooled)        |
| Before progressive disclosure, any request    | every enabled server |

## Options

| Option           | Default | Meaning                                                     |
| ---------------- | ------- | ----------------------------------------------------------- |
| `autoLoadOnCall` | true    | A call to a tool that was not loaded loads it, not an error |

Code defaults in `packages/mcp-disclosure/src/types.ts`; the pool's idle timeout is
`DEFAULT_IDLE_MS` in `pool.ts`. There is no environment configuration.

## State (per thread, via the checkpointer)

`activeTools: string[]` holds `server__tool` names in load order, through an appending, de-duplicating
reducer, so two `load_tools` calls in one step both apply. A tool whose server was disabled or
removed is left out when the list is built; no state change is needed.

## The catalog (`mcp_server_catalog`)

One row per server: the normalized `tools/list` (name, description, inputSchema, annotations), its
SHA-256 `tools_hash`, `tool_count`, `schema_tokens` (serialized JSON length / 4), a one-line
`summary` and its `summary_source`:

- `instructions` — the first sentence of the server's `instructions` (headings skipped).
- `heuristic` — `Tools: a, b, c, d and N more`.
- `generated` — one sentence from the owner's model (`src/lib/mcp/summarize.ts`), called when the
  tool list changed. Skipped when no model is configured, and a failure falls through to the two
  above. Tool descriptions are untrusted input, so the result is cut to one short line.

The owner can write a **description** on the Connections page (`mcp_server.description`). It is shown
instead of the summary, and no summary is generated while it is set.

Rows hold protocol data only, never client-library output, so they survive a client migration.
This line is all the model has to decide whether to search, so it is the catalog's most important
field. The first refresh after adding a server now includes a model call, and a chat message waits
at most `CATALOG_WAIT_MS` for it.

**Refreshed** after the response (`after()`) when a server is created, enabled, or its
connection settings are edited, and when OAuth completes — through a short-lived session, not the
pool's, since the settings may have just changed. `POST /api/mcp-servers/{id}/catalog` refreshes
on demand. An enabled server with no row is refreshed when the agent is built, but a chat message waits at most `CATALOG_WAIT_MS` (5s) for it: a slower server is left out of that message and the refresh finishes in the background, so a later message sees it. Connecting allows `CONNECT_TIMEOUT_MS` (60s), because a stdio server started with `npx` may download first.

**Failures never break chat.** A failed refresh keeps the previous row. A server with no row is
**unavailable**: left out of the catalog. A server that has a row but cannot be reached fails only
its own calls, as error results.

## Approval

`load_tools` is not gated. It only changes what the model can see, and
`MUTATING_TOOL_NAMES` is unchanged. MCP tools still auto-approve as before; cached
`annotations` (`readOnlyHint`, …) are stored but not used for approval.

## Evals

`eval/cases/mcp.cases.mts` holds the cases this design depends on: searching before using a tool,
reaching the right tool from different words, loading nothing for a question about Cameron's own
ledger, and reporting a capability that needs sign-in. They use in-process mock servers
(`eval/mcpMocks.mts`, opt in with `mcp: true`): they test whether the model finds and uses a
capability, so real servers would only add MCP plumbing. Other cases see no MCP servers.

## Debug log

One line per model call, plus one per new connection:

```
[mcp-disclosure] loaded=0/29 tools=20
[mcp-disclosure] loaded=3/29 tools=23
[mcp-disclosure] connecting to bank
```

With content capture on, each `chat` span's `gen_ai.tool.definitions` shows the same list the
model was offered (see [OBSERVABILITY.md](OBSERVABILITY.md)).

## Deferred

- Resuming a run after sign-in in place (an interrupt with the authorization URL), instead of
  asking the user to reconnect on the Connections page and ask again.
- Provider-native tool search (`defer_loading`). The same tool could sit in front of it.
- Moving the Connections page probe (`listServerTools`) behind the connector — with the v2
  adapter migration.
- Background refresh jobs.
