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
pnpm build                    # Production build (needs Postgres up — collects API route data)
pnpm lint                     # ESLint (currently broken: `next lint` was removed in Next 16)
pnpm format                   # Prettier formatting
pnpm format:check             # Check formatting

# Tests (free, offline — no DB, no model, no API keys)
pnpm test                     # Vitest, run once
pnpm test:watch               # Vitest, watch mode

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
    bounded raw rows — for _listing_ matching transactions, not totals). `query_transactions`
    returns `{ returned, matched, truncated, transactions, hint? }`: `matched` is the true total
    ignoring the limit, so a capped page is **visibly** partial. Never report a bare row count as
    a total — that was a real bug (see [docs/TESTING.md](docs/TESTING.md)).
  - `src/lib/agent/tools/analytics.ts` — `describe_finance_schema` (static curated schema doc) and
    `run_sql` (read-only). `run_sql` answers aggregate/analytical questions (totals, top-N, group-by)
    the fixed queries can't. It is **SELECT-only and cannot mutate**: static validation lives in
    `src/lib/finance/sqlGuard.ts` (single statement, SELECT/WITH only, DML/DDL deny-list with
    comments+strings stripped), and the _real_ guard is `src/lib/repositories/analyticsRepository.ts`
    — the one sanctioned raw-SQL site — which runs every query inside a `BEGIN TRANSACTION READ ONLY`
    - `statement_timeout`, always rolls back, and hard-caps returned rows. Both tools auto-approve.
      `run_sql` attaches a `note` when a result is **empty or an all-NULL aggregate row**: an
      aggregate over zero rows returns NULL, which is byte-identical whether the filtered name exists
      or not, so the agent would otherwise guess ("you have no X spending _yet_" implies X exists).
      Same defect class as the truncation bug — a payload the agent predictably misreads.
  - `src/lib/agent/tools/categories.ts` — `list_categories` (read-only) and `create_category`
    (mutating/gated).
  - `src/lib/agent/tools/config.ts` — `get_config` (read-only) and `set_config` (mutating/gated):
    owner-level settings, currently just `currency`. The key catalog is **closed and lives in
    TypeScript** (`src/lib/config/catalog.ts`, a zero-import leaf that also owns the single
    `DEFAULT_CURRENCY` literal) — `set_config` rejects an uncatalogued key with `unknown_key` and
    an invalid value with `invalid_value`, writing nothing, so an agent-invented key can never
    become a row nothing reads. `get_config` always returns a value plus **`isSet`**: an unset key
    returning only its fallback is byte-identical to the owner having chosen that fallback, which
    is the whole defect (issue #11 — a French CSV imported as USD). `key` on `set_config` is a
    plain string, not an enum, so a bad key returns a correctable payload instead of a schema throw.
  - `src/lib/agent/tools/csvImport.ts` — `inspect_csv` (read-only) + `import_transactions_csv`
    (mutating/gated); the importer validates every mapping value against the file's real headers and
    **fails loud** (returns an error, imports nothing) if a mapped column doesn't exist, rather than
    silently dropping the field. Dates are parsed with an agent-supplied `dateFormat` (date-fns
    pattern, confirmed with the user) — never guessed; unparseable rows are reported in `badDateRows`
    (bounded) + `skippedBadDate`, not dated `now()`.
- **Tool Approval**: Human-in-the-loop via `humanInTheLoopMiddleware`. Approval is gated **per-tool**
  through an `interruptOn` map that lists only **mutating** tools (`log_expense`,
  `import_transactions_csv`, `create_category`, `set_config`); read tools (incl. `run_sql`) and MCP tools
  auto-approve. `approveAllTools` omits the middleware entirely. Decisions: `allow`→approve,
  `deny`→reject (with an explanatory follow-up). `MUTATING_TOOL_NAMES` lives in
  `src/lib/agent/mutatingTools.ts` — a **zero-import leaf**; `index.ts` and `capabilities.ts` both
  re-use it from there. It is its own module because **client components need it** (the approval
  gate styles itself from it) and `capabilities.ts` reaches `pg` through the tool modules, so
  importing that from the browser pulls Postgres into the bundle. `tsc` does not catch this — the
  production build does.
- **Capabilities page** (`/capabilities`, `src/app/capabilities/page.tsx`): a plain server component
  listing the built-in tools with their real names/descriptions and an approval badge, so the only
  way to learn what Cameron can do isn't reading the source. Data comes from
  `listCapabilities()` in `src/lib/agent/capabilities.ts`, which is derived from the same tool arrays
  `index.ts` registers — a new tool appears with no UI edit. That module is deliberately a **leaf**:
  it must not import `agent/index.ts`. The CSV entries are the one hand-transcribed exception
  (`tools/csvImport.ts` imports the S3 client, which throws at module load when S3 env vars are
  unset); `capabilities.test.ts` pins them to the real tools so they can't drift. Deliberately
  minimal — the design is expected to change.

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
- **Tool rendering** (`src/components/toolRenderers/`): `config.ts` maps each **built-in** tool to a
  view for its **arguments** and its **result** (`sql`, `table`, `receipt`, field grids); anything
  not listed — every MCP tool, anything added later — falls back to `json`. A closed catalog with an
  open fallback: the payload SELECTS a client-owned renderer, it never describes one. Keyed on tool
  name rather than sniffed from the payload, because sniffing predicates are a second contract that
  drifts. `config.test.ts` pins every key to a really-registered tool, so a rename can't silently
  drop a tool back to JSON. A tool call's args render in `ToolCallDisplay`, its result in
  `ToolMessage` — two different renders of one operation.
- **Design tokens** (`src/app/globals.css`): paper ground / ink text / one amber `--brand`, mapped
  ONTO shadcn's semantic names so `ui/*` inherits them. Amber marks the approval boundary and
  nothing else. `--muted-foreground` must stay ≥4.5:1 on paper (`--faint` is the decorative-only
  escape hatch). Agent markdown is restyled under `.cameron-md .wmde-markdown …` — MDEditor ships
  its own stylesheet at equal specificity, so overrides must chain BOTH classes or they silently
  lose.
- **Agent Services**: `src/services/agentService.ts` handles streaming, `src/services/chatService.ts` manages UI state

### Database Layer (Drizzle + repository seam)

- **ORM**: Drizzle ORM over `pg`. Schema is plain TypeScript in `src/lib/database/schema.ts` (no
  codegen, no separate DSL). The single client lives in `src/lib/database/db.ts`; config in
  `drizzle.config.ts`.
- **Repository seam**: application code NEVER imports Drizzle directly. All DB access goes through
  the `src/lib/repositories/` files (`threadRepository`, `mcpServerRepository`, `transactionRepository`,
  `categoryRepository`, `analyticsRepository`, `configRepository`), which return **plain domain objects**
  (`ThreadRecord`, `MCPServer` in `src/types/mcp.ts`; `Transaction`, `Category` in
  `src/types/finance.ts`; `ConfigEntry` in `src/types/config.ts`), not Drizzle row types. This keeps the persistence layer swappable — replacing the ORM touches only these files.
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
- **Bounded reads report the true total**: `transactionRepository.list` returns
  `{ rows, total }` (a `TransactionPage`), not a bare array. `total` is the count matching the
  filters _ignoring_ the limit, so callers can tell a capped page from a complete one; the COUNT
  only runs when the page came back full. New bounded list functions should follow this shape —
  returning rows alone makes truncation invisible to the agent.
- **Error translation** lives in the repositories: a duplicate name surfaces as `ConflictError`
  (→ HTTP 409); a missing row returns `null`/`false` (→ HTTP 404). Routes check return values, not
  driver error codes.
- **`config` is settings, not a secret store**: `(key, value, updated_at)` only — no `description`
  column, because that varies per key, not per install, and no code would read it. Deliberately
  absent from `describe_finance_schema` so `run_sql` doesn't surface it; don't put credentials there.
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
- **Default model is `anthropic` / `claude-haiku-4-5`, defined in THREE places that must stay in
  sync**: `DEFAULT_MODEL_PROVIDER`/`DEFAULT_MODEL_NAME` (`src/lib/agent/util.ts`, server),
  `UISettingsContext` (client initial state), and the provider-switch map in
  `ModelConfiguration.tsx`. The UI sends `provider`/`model` as query params on every request, so
  the **client default wins** — changing only the server constant has no effect on the app.
  Existing users keep their `localStorage` choice (`agent_model_settings`); a new default only
  applies to fresh browsers.

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

## Testing

Unit tests only, via Vitest — see [docs/TESTING.md](docs/TESTING.md) for the full rationale.

- **`pnpm test` must stay free**: no model calls, no network, no DB, no API keys. Verify by
  stopping Postgres — the suite still passes. Anything needing those belongs in the future eval
  layer.
- **Tests live BESIDE the code** they test (`finance.test.ts` next to `finance.ts`), so a tool +
  its test is a self-contained unit that ports to another project. This comes from the
  [`tool-design`](https://github.com/agentailor/skills) skill and is deliberate; the future
  `eval/` tree is the opposite shape (centralized at the repo root, cross-cutting, paid).
- **Tool tests assert on the returned JSON payload** via `callTool` in
  `src/lib/agent/tools/testing.ts` — the same surface a future eval grades against, so assertions
  survive the move. Repositories are stubbed with `vi.mock`; fixtures (`makeTransaction`,
  `makeCategory`) live alongside the helper.
- **The defect class**: a tool description is a contract with a non-deterministic caller, and
  nothing else verifies the implementation honors it. When adding a tool, add its test in the same
  commit and cover every truncation / error / empty-result path — that's where agents get misled.
- `pnpm test` stays unit-only and free regardless of what the eval layer grows into.
- **CI** (`.github/workflows/`): `ci.yml` gates PRs on `pnpm test` + `tsc --noEmit`; `release.yml`
  gates `v*` tags on the same before publishing the release.

## Evals (`eval/`)

Slow, paid, non-deterministic runs against the **real agent** and a **sandbox Postgres**. Never in
CI, never part of `pnpm test`. Full detail in [eval/README.md](eval/README.md).

```bash
docker compose -f compose.eval.yaml up -d   # sandbox stack (Postgres 5545, MinIO 9110)
pnpm eval                                   # every case (most run once; a few repeat)
EVAL_MODE=fast pnpm eval <id> -v            # force one run while iterating
pnpm typecheck:eval                         # free — the root tsc misses this tree
```

- **Cases are grouped by defect class, not feature** (`eval/cases/*.cases.mts`): tool mis-selection,
  unnoticed truncation, the approval gate, prompt contracts. A case earns its place by covering
  something a unit test provably cannot.
- **Run policy is pass@k, defaulting to ONE run.** Repeats are opt-in per case (`RUN_POLICY.majority`
  / `.strict`) and each carries a comment saying why it earned one — they buy information only where
  behavior actually varies. A repo that gates merges on evals would default the other way; this suite
  gates nothing.
- **Deterministic graders only — no LLM judge.** Viable because the assertion target is usually a
  number, which has one spelling. A simulated user (below) generates the user's side of a
  conversation, but grading stays deterministic: the model produces **input**, never a verdict.
  Two rules when authoring: never let a negative grader stand alone (it passes vacuously on a run
  that did nothing), and only string-match **atomic** targets — assert structural facts (which tool
  ran, what's in the DB) instead of claims.
- **`FIXTURE` (`eval/seed.mts`) is the single source of truth** for expected figures, all derived
  from the seeding formula. Never hardcode a total in a case. Dining's 262 rows deliberately exceed
  `query_transactions`' 200-row cap — that truncation trap is the point.
- **`config` is truncated between runs** (`RESET_TABLES` in `eval/db.mts`, wider than
  `SEEDED_TABLES`): a case that establishes the owner's currency would otherwise leave it set, and
  the next case — whose premise is an _unestablished_ setting — would start already answered. A case
  needing the opposite declares `config: { currency: "EUR" }`, applied after the reset. Both halves
  earn their place: without the establish case the agent can silently default, and without the reuse
  case a settings store the agent re-asks past looks identical to one that works.
- **Order is graded, not just membership**: `toolCalledBefore(before, after)` exists because
  `toolCalled` is a set check — "asked, saved, then logged" and "logged under a guess, then saved"
  leave the same rows in the same tables, and only the order says which happened.
- **Approval cases** set `approval: "allow" | "deny"`, which keeps the HITL middleware live (plain
  `approveAllTools` omits it entirely). Paused calls land on `RunCapture.interrupts` — the only
  evidence the gate fired, since `trajectory` looks identical either way. These cases mutate, so the
  fixture is re-seeded before each run.
- **Every run writes `eval/results/latest.json`** (plus a timestamped copy; both gitignored) with
  per-run grader verdicts, trajectories, interrupts, and final answers. Read that file rather than
  asking for pasted console output — the console text scrolls away and can't be diffed. The same run
  is rendered to `latest.html` (`eval/viewer.mts`) as a standalone page with the data inlined, for
  reading or screenshotting.
- **`eval/tsconfig.json` exists** because the root tsconfig's `include` covers only `.ts`, not
  `.mts` — the whole eval tree was invisible to `tsc --noEmit`. Use `pnpm typecheck:eval`.
- **Multi-turn**: a case's `prompt` may be an array; turns replay on one `thread_id` and the
  checkpointer carries the conversation. For any behavior that requires the agent to stop and ask —
  CSV import is the current example. Grade the **consequence** (what ended up in the DB) rather than
  the conversation: whether it asked is a claim with many spellings, and there is no judge.
- **Simulated users** (`eval/simulatedUser.mts` — the ONLY file importing `openevals`): a case may
  add a `user`, a goal plus a closed fact sheet **derived from `FIXTURE`**, and the simulator
  answers the agent's questions once the scripted `prompt` turns are spent. It exists because a
  scripted turn answers the question the case author _guessed_: when the agent asks something
  reasonable but unforeseen, the script answers a different one, so the suite ends up rewarding
  agents that guess over agents that ask — the inverse of the approval-gate design. The simulator
  model is pinned **separately** from the model under test (`SIMULATOR_MODEL`) at temperature 0 and
  recorded in every report; changing it invalidates comparison with older reports. Two sentinels
  end a conversation: `###DONE###` (finished — graders run) and `###CANNOT_ANSWER###` (the agent
  asked for something outside the facts → inconclusive, naming the question so the fix is
  mechanical).
- **`inconclusive` is a third outcome**, distinct from pass/fail: the run produced no gradeable
  evidence, so graders are skipped, the pass@k denominator shrinks, and the build does **not**
  fail. Reserved for harness or case-authoring problems (five enumerated causes). "The agent did
  something wrong in a conversation" is always a plain **failure** — widening this tier is how it
  turns into a place to hide them.

### Skills

Tool conventions here follow the [`tool-design`](https://github.com/agentailor/skills) skill.
It's installed locally but gitignored (`.agents/`, `skills-lock.json`) — reinstall with:

```bash
npx skills add agentailor/skills --skill tool-design
```

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
