# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Development Commands

```bash
# Setup (requires Postgres and MinIO running)
docker compose up -d          # Start Postgres (5544) and MinIO (9100/9101)
pnpm install
pnpm db:migrate               # Apply pending Drizzle migrations

# Development
pnpm dev                      # Next.js with Turbopack (http://localhost:3100)
pnpm build                    # Production build
pnpm lint                     # ESLint
pnpm format                   # Prettier formatting
pnpm format:check             # Check formatting

# Database (Drizzle)
pnpm db:generate              # Generate a migration after editing schema.ts
pnpm db:migrate               # Apply pending migrations
pnpm db:push                  # Push schema directly (dev convenience, no migration file)
pnpm db:pull                  # Introspect an existing DB into schema
pnpm db:studio                # Database UI

# File Storage
# MinIO Console: http://localhost:9101 (minioadmin/minioadmin)
# S3 API: http://localhost:9100
```

## Architecture Overview

This is a Next.js 15 fullstack AI agent chat application using LangGraph.js with Model Context Protocol (MCP) server integration.

### Core Agent System

- **Agent Factory**: `src/lib/agent/index.ts` - Builds the agent with LangChain v1's `createAgent`
  (from the top-level `langchain` package), a prebuilt ReAct agent over LangGraph. `ensureAgent()`
  first initializes the Postgres checkpointer, then assembles the model, tools, and middleware.
- **MCP Integration**: `src/lib/agent/mcp.ts` - Dynamically loads tools from MCP servers stored in Postgres
- **Persistent Memory**: Uses LangGraph's Postgres checkpointer for conversation history
- **Built-in finance tools** (always registered server-side in `index.ts`, provider-agnostic Zod):
  - `src/lib/agent/tools/finance.ts` — `log_expense` (mutating), `query_transactions` (read-only,
    bounded raw rows — for _listing_ matching transactions, not totals).
  - `src/lib/agent/tools/analytics.ts` — `describe_finance_schema` (static curated schema doc) and
    `run_sql` (read-only). `run_sql` answers aggregate/analytical questions (totals, top-N, group-by)
    the fixed queries can't. It is **SELECT-only and cannot mutate**: static validation lives in
    `src/lib/finance/sqlGuard.ts` (single statement, SELECT/WITH only, DML/DDL deny-list with
    comments+strings stripped), and the _real_ guard is `src/lib/repositories/analyticsRepository.ts`
    — the one sanctioned raw-SQL site — which runs every query inside a `BEGIN TRANSACTION READ ONLY`
    - `statement_timeout`, always rolls back, and hard-caps returned rows. Both tools auto-approve.
  - `src/lib/agent/tools/categories.ts` — `list_categories` (read-only) and `create_category`
    (mutating/gated).
  - `src/lib/agent/tools/csvImport.ts` — `inspect_csv` (read-only) + `import_transactions_csv`
    (mutating/gated); the importer validates every mapping value against the file's real headers and
    **fails loud** (returns an error, imports nothing) if a mapped column doesn't exist, rather than
    silently dropping the field. Dates are parsed with an agent-supplied `dateFormat` (date-fns
    pattern, confirmed with the user) — never guessed; unparseable rows are reported in `badDateRows`
    (bounded) + `skippedBadDate`, not dated `now()`. See
    [.planning/csv-import-flow.md](.planning/csv-import-flow.md).
- **Tool Approval**: Human-in-the-loop via `humanInTheLoopMiddleware`. Approval is gated **per-tool**
  through an `interruptOn` map that lists only **mutating** tools (`log_expense`,
  `import_transactions_csv`, `create_category`); read tools (incl. `run_sql`) and MCP tools
  auto-approve. `approveAllTools` omits the middleware entirely. Decisions: `allow`→approve,
  `deny`→reject (with an explanatory follow-up).

### Data Flow

1. User message → `/api/agent/stream` SSE endpoint → `streamResponse()` in `agentService.ts`
2. Agent processes with tools from enabled MCP servers → streams incremental responses
3. Frontend uses `useChatThread()` hook with React Query for optimistic UI and streaming
4. Thread persistence via the repository layer → Drizzle → Postgres (threads + MCP server configs)
5. File uploads → `/api/agent/upload` → MinIO (S3-compatible storage) → returns file URLs

### Key Components Structure

- **Context Providers**: `ThreadContext` (active thread), `UISettingsContext` (UI state + model settings persisted to `localStorage` under `agent_model_settings`)
- **Custom Hooks**: `useChatThread`, `useMCPTools`, `useThreads` for data domains
- **Message Components**: Separate components for AI/Human/Tool/Error message types
- **Agent Services**: `src/services/agentService.ts` handles streaming, `src/services/chatService.ts` manages UI state

### Database Layer (Drizzle + repository seam)

- **ORM**: Drizzle ORM over `pg`. Schema is plain TypeScript in `src/lib/database/schema.ts` (no
  codegen, no separate DSL). The single client lives in `src/lib/database/db.ts`; config in
  `drizzle.config.ts`.
- **Repository seam**: application code NEVER imports Drizzle directly. All DB access goes through
  the `src/lib/repositories/` files (`threadRepository`, `mcpServerRepository`, `transactionRepository`,
  `categoryRepository`, `analyticsRepository`), which return **plain domain objects** (`ThreadRecord`,
  `MCPServer` in `src/types/mcp.ts`; `Transaction`, `Category` in `src/types/finance.ts`), not Drizzle
  row types. This keeps the persistence layer swappable — replacing the ORM touches only these files.
  Add new DB access as repository functions, not inline queries.
- **Sanctioned raw-SQL exception**: `analyticsRepository.runReadOnlyQuery` runs agent-authored SQL for
  the `run_sql` tool. It is the ONE place raw SQL executes; it runs inside a Drizzle `db.transaction`
  marked `SET TRANSACTION READ ONLY` + `statement_timeout`, always rolls back (throws an internal
  sentinel after capturing rows), and caps rows. It goes through Drizzle (not a raw `pg` client) to
  keep the seam intact — a dedicated `pg` client can be reintroduced if finer control is needed. Do
  not run raw SQL from routes/tools directly.
- **Atomic bulk import**: `transactionRepository.importWithCategories(rows)` resolves/creates
  categories (in bulk — distinct names, one lookup + one insert) and inserts the transactions inside a
  SINGLE `db.transaction`, so a failed insert rolls back any categories created. Rows carry the
  category as a NAME (`ImportRow.categoryName`); the repo maps names→ids. The CSV import tool uses this
  instead of per-row category calls.
- **Error translation** lives in the repositories: a duplicate name surfaces as `ConflictError`
  (→ HTTP 409); a missing row returns `null`/`false` (→ HTTP 404). Routes check return values, not
  driver error codes.
- **Tables**: `thread` (minimal metadata; actual history in LangGraph checkpoints) and `mcp_server`
  (stdio/http with conditional fields + OAuth token/state columns; JSON columns for flexible config).
  `id` columns are text (app-generated uuids); `updated_at` is app-managed (set on writes).
- **Naming convention**: physical DB identifiers are lowercase `snake_case` (Postgres norm — avoids
  forced quoting). TypeScript property names stay camelCase, mapped via the column helper's first
  arg (e.g. `createdAt: timestamp("created_at")`). New tables/columns follow this pattern.
- **Migrations**: live in `drizzle/` (SQL + `meta/` journal & snapshot), applied with `pnpm db:migrate`.
  Commit generated migrations. Prefer editing `schema.ts` + `pnpm db:generate`; hand-edit the SQL only
  for renames/data moves that codegen can't express (see `0000_init_snake_case.sql`).
- **Checkpointer is separate**: the LangGraph `PostgresSaver` (`src/lib/agent/memory.ts`) manages
  its own tables via its own `pg` connection and does NOT go through Drizzle or the repositories.
- **Deleting a thread spans BOTH stores**: the `thread` row (Drizzle) and the checkpointer's tables
  holding the messages. `DELETE /api/agent/threads` calls `deleteThreadCheckpoints(id)`
  (`src/lib/agent/memory.ts`) before `threadRepo.remove(id)`; any new deletion path must clear both,
  or the messages are orphaned. `setupCheckpointer()` in the same file is the shared setup guard.

### MCP Server Management

- Add servers via `MCPServerForm` → stored in database → loaded dynamically into agent
- Tool names prefixed with server name to prevent conflicts
- Server configs support environment variables and command arguments
- HTTP servers may require OAuth authentication - see [docs/OAUTH.md](docs/OAUTH.md)

### Tool Approval Workflow

- `humanInTheLoopMiddleware` (configured in `src/lib/agent/index.ts`) pauses on a **mutating** tool
  call and emits a batched `HITLRequest` interrupt; read/MCP tools run without pausing.
- Frontend detects the pending call from `tool_calls` on the last AI message, shows the approval UI,
  and re-opens the stream with `allowTool=allow/deny` (empty content) — the SSE contract is unchanged.
- `src/services/agentService.ts` translates the wire signal into a HITL resume: it reads the pending
  request via `agent.graph.getState()` and resumes with `Command({ resume: { decisions } })` — one
  decision per requested action (`allow`→`{type:"approve"}`, `deny`→`{type:"reject", message}`).

## Project-Specific Patterns

### Agent Configuration

- `ensureAgent()` ensures Postgres checkpointer is initialized before agent creation
- MCP servers queried from database on each agent creation for dynamic tool loading
- Supports OpenAI/Google/Anthropic models via `AgentConfigOptions`

### API Route Patterns

- Stream endpoints use `dynamic = "force-dynamic"` and `runtime = "nodejs"`
- Query params for streaming: `content`, `threadId`, `model`, `provider`, `allowTool`, `approveAllTools`
- MCP server CRUD follows REST patterns in `/api/mcp-servers/route.ts`
- File upload endpoint: `/api/agent/upload` accepts multipart/form-data, returns file metadata

### Streaming Architecture

- SSE with React Query: `useChatThread` manages optimistic UI + streaming updates
- Message accumulation: Frontend concatenates text chunks by message ID
- Tool approval flow uses Command objects with `resume` action

## File Upload & Storage

### MinIO Setup (Development)

- **S3-compatible object storage** runs in Docker alongside Postgres
- **Bucket**: `uploads` (auto-created on startup, public download access)
- **Web Console**: http://localhost:9101 (credentials: minioadmin/minioadmin)
- **S3 API**: http://localhost:9100

### Supported File Types

- **Images**: PNG, JPEG (max 5MB)
- **Documents**: PDF (max 10MB)
- **Text**: Markdown, Plain text (max 2MB)

### Production Migration

To switch to AWS S3, Cloudflare R2, or other S3-compatible storage:

1. Update `.env` variables:

   ```bash
   S3_ENDPOINT=  # Empty for AWS S3, or your provider's endpoint
   S3_ACCESS_KEY_ID=your_production_key
   S3_SECRET_ACCESS_KEY=your_production_secret
   S3_FORCE_PATH_STYLE=false  # false for AWS S3/R2
   ```

2. No code changes required - AWS SDK handles the rest!

### File Upload Flow

1. User selects files in `MessageInput` component
2. Files uploaded to MinIO via `/api/agent/upload` endpoint
3. File metadata (URL, key, name, type, size) stored in message options
4. Files can be passed to agent for multimodal processing

### Storage Libraries

- `@aws-sdk/client-s3` - S3 client (works with MinIO + AWS S3)
- `@aws-sdk/lib-storage` - Multipart uploads for large files
- Storage utilities in `src/lib/storage/`

## Langfuse Observability

LLM tracing is implemented via two mechanisms — see [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md) for full setup instructions.

- **`instrumentation.ts`** (project root): Next.js calls `register()` once before any route; initializes the OTel SDK with `LangfuseSpanProcessor` when `LANGFUSE_ENABLED=true`
- **`src/services/agentService.ts`**: Conditionally attaches `CallbackHandler` to each `agent.stream()` call for LangGraph-specific traces (LLM calls, tool invocations, token counts)
- Toggle tracing: set `LANGFUSE_ENABLED=true/false` in `.env` — no code changes needed
- Works with Langfuse Cloud or a self-hosted Docker instance

## OpenAPI / API Docs

Machine-readable OpenAPI 3.1 spec generated from per-route Zod schemas — see [docs/API.md](docs/API.md).

- **`src/lib/api/openapi/`**: `zod.ts` (re-exports `z` after `extendZodWithOpenApi` — import `z` from here), `registry.ts` (shared `OpenAPIRegistry`), `routes.ts` (barrel importing every route's `schema.ts` for its `registerPath` side effects), `document.ts` (`buildOpenApiDocument()` with doc metadata), `common.ts` (shared `ErrorResponse`/`UploadErrorResponse`/`SuccessResponse`)
- **Co-located pattern**: each route has a sibling `schema.ts` defining Zod schemas (`.openapi("Name")`) and calling `registry.registerPath(...)`; the handler validates input with `.safeParse()`. When adding a route, also add its import to `routes.ts`
- **Served at**: `/api/openapi` (JSON via `src/app/api/openapi/route.ts`) and `/api-docs` (Scalar viewer via `src/app/api-docs/route.ts`)
- Validate the spec: `curl /api/openapi -o openapi.json && npx @redocly/cli lint openapi.json` (config in `redocly.yaml` — disables `security-defined` since the template has no API auth)

## Important Notes

- After editing `src/lib/database/schema.ts`, run `pnpm db:generate` then `pnpm db:migrate` (or `pnpm db:push` in dev)
- Access the DB only through the repository layer (`src/lib/repositories/`) — never import Drizzle in routes/services
- Restart dev server to pick up new MCP server configurations
- Ports are distinct from the `fullstack-langgraph-nextjs-agent` template (which uses 3000 / 5434 /
  9000 / 9001) so both can run side by side: web **3100**, Postgres **5544**, MinIO API **9100**,
  MinIO Console **9101**. The compose project name is pinned to `cameron-ai` (container names
  `cameron-ai-db` / `cameron-ai-minio`) to avoid name collisions.
- Uses pnpm as package manager (see packageManager in package.json)
