# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Essential Development Commands

```bash
# PRODUCTION — the whole app on its own Postgres (5546) + MinIO (9102/9103).
# This stack holds REAL FINANCIAL DATA. See "Two stacks" below before tearing it down.
docker compose --profile full up

# DEV dependencies (contributor path) — Postgres `mydb_dev` (5544), MinIO (9100/9101). Disposable.
docker compose up -d
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

## Two stacks: dev is disposable, `--profile full` is production

`compose.yaml` defines **two stacks that share no data**. The separation is physical — separate
services, separate named volumes — not a naming convention.

|          | Default (`up -d`)                               | `--profile full`                                       |
| -------- | ----------------------------------------------- | ------------------------------------------------------ |
| Postgres | `db` → `mydb_dev`, port 5544                    | `db-prod` → `mydb`, port **5546**                      |
| MinIO    | `minio`, 9100/9101                              | `minio-prod`, **9102/9103**                            |
| Phoenix  | `phoenix`, 6006 (only with `--profile tracing`) | `phoenix-prod`, **6016**                               |
| Volumes  | `db_data`, `minio_data`, `phoenix_data`         | `prod_db_data`, `prod_minio_data`, `prod_phoenix_data` |
| Contents | seed/scratch data                               | **real financial records and their traces**            |

**`docker compose down -v` deletes named volumes.** Because the volume sets are disjoint, a `-v`
teardown of the dev stack cannot reach production. Removing production data requires naming that
stack explicitly:

```bash
docker compose down                        # stop dev, keep data
docker compose down -v                     # DESTROY dev data (safe — dev only)
docker compose --profile full down         # stop production, KEEP data  ← the safe one
docker compose --profile full down -v      # DESTROYS REAL FINANCIAL DATA — back up first
```

Treat the production stack as irreplaceable: never run `-v` against `--profile full`, and never
assume rows you did not create are disposable. Back up before anything destructive — a volume
deletion is immediate and has no undo.

**Live-test against the dev stack** (`pnpm dev` → `mydb_dev`), never against `--profile full`.

### Backing up the production database

Before any migration, teardown, or destructive experiment:

```bash
docker exec cameron-ai-db-prod pg_dump -U user -d mydb --clean --if-exists \
  > backups/cameron-$(date +%Y%m%d-%H%M%S).sql          # `backups/` is gitignored

# Restore into a running prod container:
cat backups/cameron-<stamp>.sql | docker exec -i cameron-ai-db-prod psql -U user -d mydb
```

The uploaded files live in the `prod_minio_data` volume, separately from the database — a `pg_dump`
does not include them. Copy them out with the MinIO console (9103) or `mc mirror` if they matter.

## Architecture Overview

This is a Next.js 15 fullstack AI agent chat application using LangGraph.js with Model Context Protocol (MCP) server integration.

### Core Agent System

- **Agent Factory**: `src/lib/agent/index.ts` - Builds the agent with LangChain v1's `createAgent`
  (from the top-level `langchain` package), a prebuilt ReAct agent over LangGraph. `ensureAgent()`
  first initializes the Postgres checkpointer, then assembles the model, tools, and middleware.
- **MCP Integration**: MCP servers are stored in Postgres; the agent sees their tools through the
  disclosure middleware and connects on demand (see "Progressive disclosure" below).
  `src/lib/agent/mcp.ts` now holds only the Connections page's tool-listing probe, which opens
  its session through the connector.
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
    - `statement_timeout`, **as the `cameron_analytics` role** (`SET LOCAL ROLE`), always rolls
      back, and hard-caps returned rows. The role can SELECT only `transaction` and `category`, so
      Postgres refuses `mcp_server` (OAuth tokens/env/headers, encrypted but still not the agent's), the checkpoints, `config`, `memory`
      and `thread`; a `42501` comes back as an "isn't available to `run_sql`" payload. Why
      `set_config` is revoked from PUBLIC (it is `SET ROLE` as a function):
      [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#what-run_sql-can-read). Both tools auto-approve.
      `run_sql` attaches a `note` when a result is **empty or an all-NULL aggregate row**: an
      aggregate over zero rows returns NULL, which is byte-identical whether the filtered name exists
      or not, so the agent would otherwise guess ("you have no X spending \_yet\*" implies X exists).
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
  - `src/lib/agent/tools/csvImport.ts` — a FOUR-tool flow (inspect → propose → validate → import):
    `inspect_csv`, `validate_csv_import` and `read_csv_rows` (read-only) + `import_transactions_csv`
    (mutating/gated). Full detail in [docs/CSV_IMPORT_FLOW.md](docs/CSV_IMPORT_FLOW.md). The load-bearing
    invariants:
    - **Validation is mandatory and is a SEPARATE TOOL, not a `dryRun` flag** — the import returns
      `validation_required` unless `validate_csv_import` ran with the same plan (fingerprinted over
      every argument, so changing only `dateFormat` re-triggers it). Separate because `interruptOn`
      is keyed by tool NAME: a flag would make auto-approval depend on a model-authored boolean.
    - **Nothing is refused without identity** — refused rows are reported by row NUMBER (1-based over
      DATA rows, via `dataRowNumber()`), read back with `read_csv_rows`, and recovered one at a time
      with `log_expense`. Re-importing to rescue a few rows is the bug, not the fix.
    - **Duplicate detection is reported honestly** (`duplicateDetection: "active" | "unavailable"`),
      never as `skippedDuplicates: 0` — dedup keys on `(source, externalId)` and NULL never equals
      NULL in Postgres, so a file with no id column is not deduplicated at all.
  - `src/lib/agent/tools/transactionEdits.ts` — two validate → write pairs, full detail in
    [docs/TRANSACTION_EDITS.md](docs/TRANSACTION_EDITS.md): `validate_transaction_update` →
    `update_transaction` (one row, partial, in place) and `validate_transaction_delete` →
    `delete_transaction` (1–25 ids, all or nothing, hard delete). The load-bearing invariants:
    - **Validation is bound to row state**, not just arguments: it records each row's raw
      `updated_at` and the write returns `stale` if a row moved on. The repository re-checks under
      `SELECT … FOR UPDATE` in the same transaction as the write.
    - **Delete takes ids, never SQL.** No guard can confine an agent-written DELETE the way READ
      ONLY confines `run_sql`, and a predicate re-evaluated after approval deletes unseen rows.
    - **Two review points**: an update is reviewed on its approval card (no chat step); a delete's
      validation is shown expanded in the thread and the agent waits for the user before calling
      `delete_transaction`, which is then gated as usual.
    - **The approval card shows the matched validation**, never the agent's description:
      `linkPreviews` (`src/services/editPreview.ts`) pairs a pending edit with the latest earlier
      validator result with identical arguments — the server's own rule, so it cannot preview a
      different plan than the one that runs.
  - `src/lib/agent/tools/memory.ts` — `remember`, `recall`, `forget`: owner preferences kept across
    threads, full detail in [docs/MEMORY.md](docs/MEMORY.md). **None is gated** — memories change
    what Cameron knows, not the records, and any effect on the records still passes a gated write.
    `recall`'s description lists every memory's `id · title`, rebuilt per message by
    `createMemoryTools(await memoryRepo.list())`; the system prompt is untouched. When to remember
    lives in `remember`'s description only: the memory evals (`eval/cases/memory.cases.mts`)
    pass without a system-prompt rule, so add one only for a case that keeps failing.
  - `src/lib/agent/tools/skills.ts` — `load_skill` (read-only): returns one skill's full instructions
    by name. Auto-approves — reading a skill approves nothing it tells you to do. `name` is a plain
    string, not an enum, because the skill names are already in the prompt verbatim: a wrong name is
    a mistyped copy, and `availableSkills` in the `unknown_skill` payload corrects it in one turn
    (an enum would also break the legitimate zero-skills case, since `z.enum([])` is invalid).
  - `src/lib/agent/tools/documents.ts` — `read_document` (read-only): the only way the model sees
    an uploaded image or PDF, read with the agent's own model; and `log_from_document`
    (mutating/gated): an expense linked to its file, logged once per distinct file, with the
    `skills/receipts` skill driving it. The reader, its prompt, its evals (`pnpm eval:reader`),
    the logging flow and the untrusted-document rule are all in
    [docs/DOCUMENTS.md](docs/DOCUMENTS.md) — read it before changing `src/lib/documents/`.
- **Tool Approval**: Human-in-the-loop via `approvalGateMiddleware` (`src/lib/agent/approvalGate.ts`),
  which wraps langchain's `humanInTheLoopMiddleware`. **Built-in writes and every MCP tool pause**;
  the rest runs. The rule is one function, `requiresApproval(name)` in
  `src/lib/agent/gatedTools.ts`: a name pauses unless it is in `UNGATED_TOOL_NAMES`, an
  **allowlist** of built-in reads (incl. `run_sql`), the memory tools and `load_tools` (which only
  changes what the model sees). `GATED_TOOL_NAMES` (`log_expense`, `import_transactions_csv`,
  `create_category`, `set_config`, `update_transaction`, `delete_transaction`,
  `log_from_document`) still names the built-in writes. An allowlist because `interruptOn` is
  keyed by name and a name missing from it runs unreviewed — and MCP tool names are only known
  mid-thread (`load_tools`, saved `toolDefinitions`), so the wrapper builds `interruptOn` per model
  step from the names actually called. `capabilities.test.ts` pins the two lists to the registered
  tools, so a new built-in read is gated until it is listed. **The gate cannot be switched off from the product**: no UI control, no query
  param, and nothing on `MessageOptions` can disable it — `bypassApprovalForEval` omits the
  middleware for the eval harness alone, which calls the agent factory in-process and has no human
  to answer an interrupt (`approvalGate.test.ts` pins that boundary). Decisions: `allow`→approve,
  `deny`→reject (with an explanatory follow-up). `gatedTools.ts` is a **zero-import leaf**; the
  gate, the resume mapping (`approvalDecisions.ts`), the tracer and the chat UI all read it. It is
  its own module because **client components need it** (the approval
  gate styles itself from it) and `capabilities.ts` reaches `pg` through the tool modules, so
  importing that from the browser pulls Postgres into the bundle. `tsc` does not catch this — the
  production build does.
- **Capabilities page** (`/capabilities`, `src/app/capabilities/page.tsx`): a plain server component
  listing the built-in tools with their real names/descriptions and an approval badge, so the only
  way to learn what Cameron can do isn't reading the source. Data comes from
  `listCapabilities()` in `src/lib/agent/capabilities.ts`, which is derived from the same tool arrays
  `index.ts` registers — a new tool appears with no UI edit. That module is deliberately a **leaf**:
  it must not import `agent/index.ts`. Three groups are hand-transcribed rather than imported, all
  because the real module reaches something that blows up at module load: `tools/csvImport.ts` and
  `tools/documents.ts` import the S3 client (throws without S3 env vars), and `tools/skills.ts`
  reaches the registry (reads the filesystem). `capabilities.test.ts` pins them to the real tools
  so they can't drift.
  Deliberately minimal — the design is expected to change.

### Scheduled tasks (`tasks/` + `src/lib/tasks/` + `packages/agent-tasks`)

Work Cameron does on a schedule while the owner is away — full detail in
[docs/TASKS.md](docs/TASKS.md). The generic half (task files, cron slots, run lifecycle, the loop)
is the workspace package `packages/agent-tasks`
([README](packages/agent-tasks/README.md)), which must not import app code, a database client or
LangChain.

- **A task is `tasks/<name>/TASK.md`** (closed frontmatter `name`, `description`, `schedule`,
  `timezone`, `tools`; the body is the brief; `tools` is a declaration Cameron shows as suggested
  grants), read once at startup like skills.
- **Grants** ([docs/GRANTS.md](docs/GRANTS.md)): a `tool_grant` row lets a tool run without
  pausing within a scope; only `task` scopes exist so far. Every built-in write is grantable except
  `delete_transaction` (a hard delete, barred in `pausesFor`); MCP tools are granted one by one
  ("all tools listed now" grants each), so a new server tool asks first. A run fixes its grants
  when it starts (`task_run.granted_tools`) and a resumed turn on its thread reuses them; never in
  ordinary chat, never from a request. `readPendingBatch` matches the gate's own requests, since
  a step can mix granted and gated calls.
- **Off until the owner enables it** (`task_setting`); slots before `enabled_at` never run. Run now
  works either way. `/tasks` lists tasks, runs, and runs **waiting for you**.
- **A run is the same agent and approval gate on a new thread** (`executeTask` in
  `src/lib/tasks/scheduler.ts`). A pending approval leaves it `paused`; the owner approves in the
  thread as usual, and `streamResponse` → `syncTaskRun` records the result. The package never
  resumes a run.
- **A slot runs at most once** because `task_run` is unique on `(task_name, slot)`; there is no
  lock. The loop starts in `instrumentation.node.ts`, one scheduler per process on `globalThis`.
- **A reloaded paused thread shows its approval card**: `fetchThreadHistory` rebuilds
  `pendingToolCallIds` from the checkpoint's pending interrupt. Before, only the live stream had them.
- **Limits** (runs at once; timeout and retries, globally or per task) are set on `/tasks` and
  read per run. The global ones are `config` keys kept **out of the agent's catalog**, like the model
  settings. A run gets the attempt's abort signal; a retry or recovery continues the same thread
  from its checkpoint (`continuationOf`); the executor **returns** (so the package
  never retries) running out of steps and a missing model; anything it throws is retried. The Docker image sets `NEXT_MANUAL_SIG_HANDLE` so SIGTERM stops runs
  gracefully.
- `task_setting` / `task_run` are not granted to `cameron_analytics`.

### Skills (`skills/` + `src/lib/skills/`)

Instructions loaded on demand, in the standard `SKILL.md` format — full detail in
[docs/SKILLS.md](docs/SKILLS.md).

- Names + descriptions go into the system prompt at startup (`buildSystemPrompt()` in
  `agent/prompt.ts`); the agent calls **`load_skill`** to pull one skill's body into context. No
  bash, no sandbox, no agent-facing filesystem.
- **`skills/` (committed, product code) is not `.agents/skills/` (gitignored dev tooling).**
- Read once at module load and cached (`src/lib/skills/registry.ts`) — adding a skill needs a
  restart. Sorted by name so the prompt is identical across machines.
- **Absence is fine, brokenness is not**: an empty or missing `skills/` loads silently; a skill that
  exists but fails to read or validate is logged and dropped.
- `output: "standalone"` does not trace files read from disk, so the Dockerfile `COPY` +
  `outputFileTracingIncludes` are what stop production running with zero skills and no error.

### Data Flow

1. User message → `/api/agent/stream` SSE endpoint → `streamResponse()` in `agentService.ts`
2. Agent processes with tools from enabled MCP servers → streams incremental responses
3. Frontend uses `useChatThread()` hook with React Query for optimistic UI and streaming
4. Thread persistence via the repository layer → Drizzle → Postgres (threads + MCP server configs)
5. File uploads → `/api/agent/upload` → MinIO (S3-compatible storage) → returns file URLs

### Thread lifecycle

- **A thread row is created by the first message, never by opening a screen.** `/` is the new-chat
  screen and renders `<Thread threadId={null} />`; `Thread` creates the thread inside its first
  `handleSendMessage`. "New" in the sidebar navigates to `/` rather than POSTing. Creating on mount
  is what filled the DB with empty "New thread" rows, one per refresh.
- **The title is derived from that first message** (`deriveThreadTitle`, word-boundary truncated)
  and passed to `POST /api/agent/threads`. The body is optional and the title falls back to
  `DEFAULT_THREAD_TITLE`, so a bare POST still works. There is no title-generating model call.
- **The URL is the active thread.** `useActiveThreadId()` parses the pathname; the sidebar's
  highlight and `useThreads().activeThreadId` both read it. Nothing mirrors it in React state.
- **The new-chat screen adopts its URL with `window.history.replaceState`, not `router.replace`** —
  a router navigation remounts the subtree and tears down the in-flight `EventSource` mid-stream.
  Because `replaceState` does not re-render, `Thread` also tracks the adopted id in state and passes
  it as `opts.targetThreadId` so the send targets the new thread's cache key.

### Key Components Structure

- **Context Providers**: `UISettingsContext` (UI state + model settings persisted to `localStorage`
  under `agent_model_settings`). The active thread is NOT in a context — it is derived from the URL
  by `useActiveThreadId()`, so there is one source of truth.
- **Custom Hooks**: `useChatThread`, `useMCPServers`, `useThreads` for data domains
- **Message Components**: `AIMessage` (prose only — tool calls riding on it are rendered by
  `ToolActivityGroup`, not here), `HumanMessage`, `ErrorMessage`
- **Tool rendering** (`src/components/toolRenderers/`): `config.ts` maps each **built-in** tool to a
  view for its **arguments** and its **result** (`sql`, `table`, `receipt`, field grids); anything
  not listed — every MCP tool, anything added later — falls back to `json`. A closed catalog with an
  open fallback: the payload SELECTS a client-owned renderer, it never describes one. Keyed on tool
  name rather than sniffed from the payload, because sniffing predicates are a second contract that
  drifts. `config.test.ts` pins every key to a really-registered tool, so a rename can't silently
  drop a tool back to JSON.
- **A call and its result render as ONE card** (`ToolActivityGroup.tsx`). The wire delivers them as
  two messages — the call on an AI message, the result as its own `tool` message — and the template
  drew two cards for them. `buildThreadItems()` (`src/services/toolActivity.ts`) pairs them by
  `tool_call_id` (never by adjacency: results arrive when they resolve, and a paused call never gets
  one) and groups CONSECUTIVE calls into one card. Collapsed by default.
  - **Header label**: a single call gets its own gist (`run_sql · 37 rows`); several get a generic
    `N tools called`, because no summary spans differently-shaped payloads. `summarizeResult` takes
    the tool name so `ok: true` reads as "written" only for a **mutating** tool.
  - **Two things are never collapsed**: a gated call's ARGUMENTS (you cannot approve what you cannot
    read) and a CHART (it is the answer, not a detail — and it renders with no JSON receipt under
    it). A drawn chart leaves the collapsed list entirely.
  - There is no global "hide tools" toggle any more; collapsing per card replaced it.
  - **A result can also escape the collapse** with `open` in the renderer config: `true` always
    (a delete preview the user reviews), `"ok"` only when the payload has `ok: true` (the memory
    notice for `remember` / `forget`, whose failures the agent retries unseen). See
    [docs/MEMORY.md](docs/MEMORY.md).
- **Design tokens** (`src/app/globals.css`): paper ground / ink text / one amber `--brand`, mapped
  ONTO shadcn's semantic names so `ui/*` inherits them. Amber marks the approval boundary and
  each page's primary CTA (Save / Add — `primaryButton` in `src/components/ui/formStyles.ts`, which
  every settings-style form shares), and nothing else: not toggles, links or data (charts avoid it). `--muted-foreground` must stay ≥4.5:1 on paper (`--faint` is the decorative-only
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
  `categoryRepository`, `analyticsRepository`, `configRepository`, `mcpServerCatalogRepository`, `memoryRepository`, `taskRepository`), which return **plain domain objects**
  (`ThreadRecord`, `MCPServer` in `src/types/mcp.ts`; `Transaction`, `Category` in
  `src/types/finance.ts`; `ConfigEntry` in `src/types/config.ts`; `Memory` in `src/types/memory.ts`), not Drizzle row types. This keeps the persistence layer swappable — replacing the ORM touches only these files.
  Add new DB access as repository functions, not inline queries.
- **Sanctioned raw-SQL exception**: `analyticsRepository.runReadOnlyQuery` runs agent-authored SQL for
  the `run_sql` tool. It is the ONE place raw SQL executes; it runs inside a Drizzle `db.transaction`
  marked `SET TRANSACTION READ ONLY` + `statement_timeout` + `SET LOCAL ROLE cameron_analytics`,
  always rolls back (throws an internal sentinel after capturing rows), and caps rows. Failures
  throw `QueryError` (in `sqlGuard.ts`) carrying the SQLSTATE. **What `run_sql` can read is the
  role's grants** (migration `0006_analytics_readonly_role.sql`), not a filter in code: a new
  finance table needs both a `describe_finance_schema` entry and a `GRANT SELECT … TO
cameron_analytics` migration, and `analytics.test.ts` fails if the two differ. Migrations must
  run as a superuser (the migration checks and raises otherwise). It goes through Drizzle (not a raw `pg` client) to
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
- **Transaction repository types** (inputs, pages, snapshots, guarded results) live beside it in
  `transactionTypes.ts`, so callers can name them without importing the database client.
- **Guarded edits**: `transactionRepository.updateIfUnchanged` / `removeManyIfUnchanged` lock the
  rows, compare each one's `version` (the raw `updated_at` literal, from a `TransactionSnapshot`)
  and write in one transaction, returning `not_found` / `stale` instead of throwing. The old
  unguarded `remove` is gone; add any new transaction write the same way.
- **Paged reads use a cursor, not an offset**: `threadRepository.list({ limit, cursor })` returns
  `{ rows, total, nextCursor }` (a `ThreadPage`) and the wire cursor is `(updatedAt, id)` as ISO.
  Offsets are wrong here because the sort key `updatedAt` moves while paging — a message in an older
  thread reorders the list, so pages skip or repeat rows. `GET /api/agent/threads` takes
  `limit`/`cursorUpdatedAt`/`cursorId` and returns `{ threads, total, nextCursor }`; the sidebar
  pages it with `useInfiniteQuery` (`THREADS_PAGE_SIZE`).
- **Timestamp columns are `mode: "string"` and return NAIVE literals that are already UTC**
  (`"2026-09-05 10:20:18.013"`). `new Date(...)` on one reads it as LOCAL time and silently shifts
  it by the server's offset. Every repository reads them through `columnToDate` /
  `columnTimestampToIso` and writes comparisons through `toColumnTimestamp`, all in
  `src/lib/database/timestamps.ts`; any new code reading these columns must do the same. This bug is
  invisible: a shifted value still parses, and a shifted cursor still queries — it just matches
  nothing and ends the list early. (Until #44 only `threadRepository` did this, so every
  transaction's `occurredAt` came back an hour off on a UTC+1 host.)
- **Amounts are major units everywhere** (`amount numeric(14,2)`, always positive, direction in
  `type`): stored, returned by every tool, and seen by `run_sql`. There is no cents column and no
  conversion step — a unit that differed between tools made the agent report $7.00 as $0.07 (#43).
  `numeric` is exact; Drizzle's `mode: "number"` parses it, while raw `run_sql` results return it
  as a string.
- **Error translation** lives in the repositories: a duplicate name surfaces as `ConflictError`
  (→ HTTP 409); a missing row returns `null`/`false` (→ HTTP 404). Routes check return values, not
  driver error codes.
- **Encrypted columns**: `mcp_server.env`, `headers`, `auth_tokens`, `client_info`, `oauth_client` hold
  `secretBox` envelopes; the row id + column are bound as AAD (`secretContext()`), so a value
  copied between rows won't decrypt. Never read or write them outside the repository.
- **`config` is settings, not a secret store**: `(key, value, updated_at)` only — no `description`
  column, because that varies per key, not per install, and no code would read it. Absent from
  `describe_finance_schema` and not granted to `cameron_analytics`, so `run_sql` cannot read it;
  still, don't put credentials there.
- **`memory` holds owner preferences no code reads** (v7, [docs/MEMORY.md](docs/MEMORY.md)):
  `title` is unique ignoring case (`memory_title_key` on `lower(title)`), and a duplicate is a
  result, not an error: `memoryRepository.create` returns `duplicate_title` with the memory holding
  it, so the caller can replace it. `source_thread_id` has no FK, so deleting a thread keeps its
  memories. Limits (length, count) belong to the tool, not the repository. Not granted to
  `cameron_analytics`, and wiped between eval runs (`RESET_TABLES`).
- **Tables**: `thread` (minimal metadata plus `last_error`, the last failed run; actual history in LangGraph checkpoints) and `mcp_server`
  (stdio/http with conditional fields + OAuth token/state columns; JSON columns for flexible config).
  `drizzle.config.ts`'s `tablesFilter` must list every app table, or drizzle-kit ignores it.
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

- **`/connections`** (`src/app/connections/page.tsx`, components in `src/components/connections/`)
  lists servers and adds/edits them inline — no dialogs. The add form sits behind an
  `Add server` button ABOVE the list (open by default when nothing is connected), so a growing list
  never pushes it off-screen; a filter or two-pane layout is deferred until lists actually grow. Named for connections in general, not MCP,
  so other kinds can join it later. Stored in the DB and read by the agent on every message, so a
  change applies from the next message with no restart.
- **The form and the JSON are two views of one draft.** All conversion lives in the pure
  `src/lib/mcp/configParse.ts` (tested beside it): it reads the `mcpServers` / VS Code `servers`
  block, a bare map, a single object or a `"name": {…}` fragment, infers the transport when
  `type`/`transport` is absent, and judges each server separately. Switching JSON → form is refused
  while the JSON is invalid, so nothing is silently dropped. A paste holding several servers opens a
  checklist (`BatchReview`) and adds them one at a time with a per-server outcome.
- **Env values, headers, OAuth tokens, client info and pre-registered clients are encrypted at
  rest** (AES-256-GCM, `CAMERON_SECRET_KEY`), inside `mcpServerRepository` ONLY — see "Token
  Storage Security" in [docs/OAUTH.md](docs/OAUTH.md). Legacy plaintext reads through; every write
  seals; a missing key throws on the first secret write or envelope read, never writes plaintext.
  Servers created before encryption must be recreated. `code_verifier` and `oauth_state` are
  deliberately not covered.
- **The API never returns credentials**: every `/api/mcp-servers` response goes through
  `toPublicServer()` (`src/lib/mcp/publicServer.ts`), an ALLOWLIST — tokens, `client_info`, the
  verifier, the state and the client secret (reduced to `hasSecret`) stay server-side, and a new
  `MCPServer` field does too until it is listed. `env`/`headers` are sent because the form edits
  them. Until this, `GET` returned the whole decrypted row, tokens included.
- **Tools are listed on demand, one server at a time**: `GET /api/mcp-servers/{id}/tools` connects to
  that server only (enabled or not), then closes the client. Listing tools means connecting (for stdio,
  spawning a process), so nothing connects on page load and no tool count is stored — a stored count
  goes stale while looking current. Failures are typed (`auth_required`, `invalid_config`, `timeout`,
  `connect_failed`), never an empty list.
- `toServerConfig()` (`src/lib/mcp/serverConfig.ts`) turns a row into a client config, and
  `openSession()` (`src/lib/mcp/connector.ts`) connects it for BOTH the agent and the probe, so
  the page connects exactly the way the agent will.
- **Adapter is `@langchain/mcp-adapters` 2.x on MCP SDK v2 (`@modelcontextprotocol/client`)**;
  `@modelcontextprotocol/sdk` (v1) is gone, OAuth code included. Tool names are the adapter's
  default `server_tool`, and the disclosure package builds the same names (`prefixedToolName()`),
  so the connector renames nothing. Elicitation is on (`elicitation: true` per server): a server's
  question mid-call is an `mcp_elicitation` interrupt the owner answers on a card, see
  [docs/MCP_ELICITATION.md](docs/MCP_ELICITATION.md). v2 config is strict: unknown
  keys throw at construction, and stdio `args` is required.
- Tool names are prefixed `server_tool`; server names are restricted to `[A-Za-z0-9_-]` in the form
  because the prefix becomes part of a provider tool name.
- HTTP servers may require OAuth authentication - see [docs/OAUTH.md](docs/OAUTH.md). Saving an
  HTTP server probes it and records its OAuth status before responding (the Connect button only
  renders for `REQUIRED` / `EXPIRED` / `UNKNOWN`, so a NULL status hid sign-in entirely), and a
  401 at connect time records `REQUIRED`/`EXPIRED` and returns `auth_required`. The check route
  delegates to the SDK's `auth()` — never hardcode a scope in the client metadata.
  - **Two client sources, one flow** (`src/lib/mcp/clientSource.ts`): dynamic (DCR, cached in
    `client_info`, disposable) or pre-registered (`oauth_client`, the owner's config: never
    deleted by invalidation, which drops only the sign-in). Set means pre-registered, no mode
    flag. A pre-registered server is `REQUIRED` by declaration, not by probe — a server may
    answer everything but `tools/call` unauthenticated. Its scope goes to `auth()`
    (`provider.requestedScope`): the SDK ranks the server's `scopes_supported` above client
    metadata. Its `authorizationParams` (extra query parameters the owner adds) are added in `redirectToAuthorization`; reserved ones (`RESERVED_AUTHORIZATION_PARAMS` in the
    zero-import `src/lib/mcp/oauthClient.ts`) are refused on save and skipped there.
  - **One callback, `/api/oauth/callback`** (`oauthCallbackUrl()`), shown with a copy button on
    `/connections` so it can be pasted into an OAuth client first. The server is found by the
    single-use `oauth_state` the provider's `state()` stored (unique index); an unknown state is
    refused — that is the CSRF check. A dynamic client registered for another redirect URI
    (the old per-server path) reads as absent, so the SDK re-registers.
  - **The client secret is write-only**: an edit that omits it keeps it, `null` removes it, the
    JSON tab never shows a stored one. A new client id, scope or authorization parameter clears
    the tokens and asks for Connect again (`sameSignIn`): kept tokens would stay `CONNECTED`
    under the old consent, hiding Connect. A new secret alone keeps them.
- **Progressive disclosure** ([docs/MCP_DISCLOSURE.md](docs/MCP_DISCLOSURE.md), read it before
  changing this code): the model sees a short list of capabilities plus `load_tools`, and a tool's
  definition only once a search has loaded it; nothing connects until a tool is called. A loaded
  tool's definition is saved in the thread (`toolDefinitions`), so it stays offered after its
  server is removed or turned off, and a call to it returns `server_unavailable`. The logic
  is the workspace package `packages/mcp-disclosure`, which must not import app code or the MCP
  client library; `src/lib/mcp/connector.ts` is the only file using the adapters.

### Server questions (MCP elicitation)

Full detail in [docs/MCP_ELICITATION.md](docs/MCP_ELICITATION.md). The load-bearing invariants:

- **A server's question is not an approval.** It comes during a call the gate already approved. A
  run pauses on one or the other, never both, and the run's output (`__interrupt__`) says which:
  on a question, `streamMessages` reports no pending approvals and sends a `pendingElicitations`
  marker (read via `readElicitations`). The client counts only markers after the owner's last
  message, clears them once answered, and renders `ElicitationCard` on the matched call.
- **A suspended call has no result.** langchain settles a call still paused at the end of a run
  with `undefined` output; `pumpToolCalls` skips it, since `""` would close the call and hide the card.
- **Answers are refused, never defaulted**: `resolveElicitationAnswers`
  (`src/services/elicitationAnswers.ts`) checks every answer against the pending questions and
  their schema before the resume (`answers=` on the stream route, built by `toElicitationResume`).
- **Declined or dismissed** results get a `[cameron]` note (`elicitationNoteMiddleware`, keyed by
  call id through the run's `configurable`), because the server's withheld result looks like "no
  matches".
- **Grants never answer a question**: a task run pauses with reason `server_request`. The eval
  runner declines every question (`declineAll`).
- The server's message is untrusted (it can quote an email subject): the card renders `**bold**`
  only.

### Tool Approval Workflow

- `approvalGateMiddleware` (installed in `src/lib/agent/index.ts`) pauses on every call
  `requiresApproval` names — a built-in write or any MCP tool — and emits langchain's batched
  `HITLRequest` interrupt; built-in reads, memory and `load_tools` run without pausing. A call the
  disclosure middleware answers itself (`server_unavailable`, `unknown_tool`, `auth_required`) is
  still approved first: the gate runs after the model, before any tool is resolved.
- **The server says which calls are pending; the client never infers it.** Once a run settles,
  `streamMessages` re-emits the AI message carrying `pendingToolCallIds` — the calls the model
  requested that never executed, which is exactly what the gate paused. The frontend shows the
  approval UI for those ids and, once every one has a decision, re-opens the stream with
  `decisions={"<callId>":"allow"|"deny",…}` (empty content); the SSE contract is otherwise unchanged. Position in the message list is NOT a pending signal:
  tool results and later AI text both arrive after the call, so "is it last?" is wrong in both
  directions — it hid the gate on a real pause and offered APPROVE on read-only tools.
- `ToolActivityGroup` additionally requires `requiresApproval(name)` (`isGated` on the activity)
  before rendering the amber panel. Two independent conditions, because that panel claims the call
  needs your decision. Its copy says "writes to your data" for a built-in write (`isGatedTool`) and
  "a tool from a connected server" for an MCP call.
- **One decision per call, never one for the batch (#45).** The middleware batches every gated call
  of one model step into one interrupt and aligns decisions by POSITION; its `actionRequests` carry
  no call id. Each card records its own decision in `useChatThread` ("waiting for N more", with a
  `change` link) and the batch is sent only when all are in.
  `src/services/approvalDecisions.ts` (pure, tested beside it) owns the mapping: `readPendingBatch`
  rebuilds the order from the paused AI message's gated calls, and `resolveDecisions` checks it
  against the action requests (name + args) and **refuses** — nothing resumes — on a missing,
  unknown or invalid id or any misalignment. A decision is never defaulted or copied.
- **A denial sends the whole step back — by design, not a workaround.** Calls the model makes in one
  step form one plan, so they run together or not at all; a denial lets the model re-plan rather
  than run the rest of a plan the user partly refused. Don't "fix" it so approved siblings run.
  Mechanically: when any call in a batch is rejected, the middleware drops the APPROVED siblings
  and returns to the model, so those would vanish from the history unseen. `resolveDecisions`
  therefore rejects them with `HELD_BACK_MESSAGE` ("approved, not run — request it again"), and
  the agent re-requests them, gated again. The card says "not run" rather than pretending it ran. The eval harness answers interrupts through the same two functions.
- **Build the resume with `toResumeCommand()`, never your own `new Command`.** Under tsx the eval's
  `.mts` files load `@langchain/langgraph` as ESM and `src/` loads it as CJS: two `Command`
  classes. `createAgent`'s `invoke` checks `instanceof Command`, so a foreign one is merged into
  state as fresh input, the graph restarts, and the next model call carries the gated call with
  no result (a 400 on strict OpenAI-compatible endpoints). `approvalResume.test.ts` pins both.

## Project-Specific Patterns

### Agent Configuration

- `ensureAgent()` ensures Postgres checkpointer is initialized before agent creation
- MCP servers and their cached catalog are read on each agent creation; a server is connected
  only when one of its tools is called (pooled across requests)
- **The owner picks the provider and model in the app; nothing is inferred.** Supported:
  `google`, `openai`, `anthropic`, `openai-compatible` (any OpenAI chat-completions endpoint —
  Ollama, vLLM, Groq, OpenRouter, DeepSeek). There is no default pair and no env var for the
  choice: with nothing stored the app is unconfigured, and `/` says so instead of guessing.
- **Stored in the `config` table but deliberately NOT in `src/lib/config/catalog.ts`.** That
  catalog is the allowlist gating `set_config`, so keys absent from it are invisible and
  unwritable to the agent — Cameron cannot read or change which model it runs on.
  `src/lib/agent/modelSettings.ts` owns read/write; `readModelSettings()` returning `null` is the
  single definition of "unconfigured".
- **API keys stay in env and are never read for readiness.** Settings names the variable each
  provider needs and never inspects it; a bad key surfaces as a failed message, not a pre-flight
  check. Keys and the compatible endpoint's base URL are never returned by `/api/agent/config`.
- `buildAgent` uses an explicit `cfg.provider` + `cfg.model` when given (the eval path), else the
  stored settings.

### API Route Patterns

- Stream endpoints use `dynamic = "force-dynamic"` and `runtime = "nodejs"`
- Query params for streaming: `content`, `threadId`, `model`, `provider`, `decisions`
  (deliberately NO approval-bypass param — see the approval workflow above)
- MCP server CRUD follows REST patterns in `/api/mcp-servers/route.ts`; `/api/memories` follows the
  same shape (`GET` lists, `DELETE ?id=` forgets) for the `/memory` page
- File upload endpoint: `/api/agent/upload` accepts multipart/form-data, returns file metadata

### Streaming Architecture

- SSE with React Query: `useChatThread` manages optimistic UI + streaming updates
- Message accumulation: Frontend concatenates text chunks by message ID
- Tool approval flow uses Command objects with `resume` action
- **`src/services/messageStream.ts` owns the chunk ordering**, split out of `agentService.ts`
  because that module reaches Postgres at import time and a unit test must stay free. It merges the
  run's independent projections (`messages`, `toolCalls`, `values`) into one ordered queue.
- **A tool result is emitted when it RESOLVES, never when the run ends.** Only tools listed in
  `src/lib/agent/artifactTools.ts` (`render_chart`) may await `run.output` to pick up their
  client-only artifact. Waiting whenever an artifact is merely absent is indistinguishable from
  waiting for one that will never come — it parked the pump on every ordinary tool and pushed all
  results to the end of the turn. `messageStream.test.ts` pins both this and the pending contract.
- **A result a middleware returned itself is streamed from the state.** The disclosure middleware
  answers some calls without running the tool node (`server_unavailable`, `auth_required`,
  `unknown_tool`), so they never appear on `run.toolCalls`. `streamMessages` also takes results
  from `run.values` snapshots and the final state, for calls this run requested, each sent once
  (`pushResult`). Without it the result showed only after a reload, and the call was reported as
  `pendingToolCallIds`, the approval signal.
- **A malformed tool call is retried, never dropped silently.** Arguments that don't parse land in
  `invalid_tool_calls` (or, in LangChain's v1 output format, only as `invalid_tool_call` content
  blocks: read both, via `findInvalidCalls`). The agent never runs such a call, so with no valid
  calls the turn just ended. `invalidToolCallMiddleware` (`src/lib/agent/invalidToolCalls.ts`,
  installed just inside disclosure so it sees the full tool list) re-asks the model up to
  `MAX_INVALID_CALL_RETRIES` times with a correction (`invalid_arguments`, or `unknown_tool` for a
  tool not offered) that is never saved to the thread; after that the response ends with a
  visible notice. The stream shows the same notice live for every malformed attempt.
- **A tool that throws becomes an error result, never a failed run.** With any `wrapToolCall`
  middleware installed (disclosure is one), langchain rethrows a tool's error instead of
  returning it, which ended the turn and left the call without a result. `toolFailureMiddleware`
  (`src/lib/agent/toolFailures.ts`, OUTERMOST) catches it and returns
  `{ ok: false, error: "tool_failed", message }`, with the message capped at
  `MAX_TOOL_ERROR_CHARS` (the full error goes to the server log). Interrupts and aborts still
  propagate. The stream's `run.toolCalls` still rejects that call's `output` with the raw error,
  so `pumpToolCalls` skips a call with status `error` and sends the result from the state
  instead. The same middleware answers a call left without a result (a run that died
  mid-call) with `not_finished`, in the request only, and the chat shows such a call as
  "did not finish" once nothing is streaming (`buildThreadItems(…, { settled })`).
- **A failed run is saved on its thread, not in the conversation.** The stream route's catch
  calls `recordRunError` (`agentService.ts`), which turns the error into
  `{ code, message, detail }` with `describeRunError` (`src/lib/agent/runErrors.ts`, a leaf the
  client also imports). The message says what to do, naming the selected provider's key env var
  for a 401. That is written to `thread.last_error` and sent as the SSE `error` event.
  `fetchThreadHistory` appends it as a `type: "error"` message, so a reload still explains the
  unanswered message. `streamResponse` clears it when the next run starts. It never enters the
  checkpoint, because the model would read it on the next turn. `ErrorMessage` renders it:
  laid out like an agent reply, with the raw error behind "details".
- **Old tool results are cleared from the request, never from the thread** (full detail in
  [docs/MEMORY.md](docs/MEMORY.md)). `contextEditingMiddleware` (`src/lib/agent/contextEditing.ts`,
  the innermost `wrapModelCall`) runs langchain's `ClearToolUsesEdit` past `CONTEXT_CLEAR_TRIGGER`
  approximate tokens, keeping the last `CONTEXT_KEEP_RESULTS` results and `NEVER_CLEARED_TOOLS`.
  It is NOT langchain's own `contextEditingMiddleware`: `createAgent` passes `wrapModelCall` the
  state's own message array, and the built-in edits it in place, so the placeholders were saved
  into the checkpoint. Cameron's copies the array first (`contextEditing.test.ts` fails without
  the copy). `summarizationMiddleware` is not used for the same reason: it rewrites the thread.
- **Dedup and React keys are `type:id`, not `id`.** Ids are unique only within a type (an AI
  message's synthetic id and a tool message's call id are different namespaces).

## File Upload & Storage

### MinIO Setup (Development)

- **S3-compatible object storage** runs in Docker alongside Postgres
- **Bucket**: `uploads`, auto-created and **private** (`mc anonymous set none` on every `up`, so
  older volumes that were public get closed too). Uploads hold receipts and statements, so a
  bucket anyone on the network can read breaks the "your data, your infrastructure" rule.
- **Browsers never talk to MinIO.** They fetch `/api/files/{key}` (`src/app/api/files/[key]/route.ts`),
  which serves only keys the upload route mints (`<uuid>.<ext>`, checked by `isServableFileKey`
  in the zero-import leaf `src/lib/storage/fileUrl.ts`). `HumanMessage` builds the URL from the
  stored KEY, not the stored `url`, because threads from before this change saved direct bucket
  links. This also removed `S3_PUBLIC_URL`: only the server needs to reach `S3_ENDPOINT`.
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
4. The model gets a `fileKey` reference, never the bytes (`processAttachmentsForAI` in
   `src/lib/storage/content.ts`); it reads an image or PDF with `read_document`, a CSV with
   `inspect_csv`

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
  gates `v*` tags on the same before publishing the release. If a release for the tag already
  exists (written by hand), it skips creation and leaves that release untouched.

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
- **Multi-thread cases** (`threads: [{ prompt, user? }]`) run later conversations on NEW threads,
  in order; the database carries over, the conversation doesn't. `inThread(n, grader)` scopes any
  grader to one thread. **The agent is rebuilt per message** (`run.mts` passes the runner a
  factory), as in the app: `recall`'s description lists the memories present at build time, so one
  agent per run would hide a memory saved in thread 1 from thread 2. `memories: [...]` seeds
  stored preferences after the reset; `memorySaved` / `memoryCount` grade the table.
- **Approval cases** set `approval: "allow" | "deny"`, which keeps `approvalGateMiddleware` live (plain
  `bypassApprovalForEval` omits it entirely). Paused calls land on `RunCapture.interrupts` — the only
  evidence the gate fired, since `trajectory` looks identical either way. These cases mutate, so the
  fixture is re-seeded before each run.
- **Every run writes `eval/results/latest.json`** (plus a timestamped copy; both gitignored) with
  per-run grader verdicts, trajectories, interrupts, and final answers. Read that file rather than
  asking for pasted console output — the console text scrolls away and can't be diffed. The same run
  is rendered to `latest.html` (`eval/viewer.mts`) as a standalone page with the data inlined, for
  reading or screenshotting.
- **`eval/tsconfig.json` exists** because the root tsconfig's `include` covers only `.ts`, not
  `.mts` — the whole eval tree was invisible to `tsc --noEmit`. Use `pnpm typecheck:eval`.
- **Multi-turn**: `prompt` is a single opening message; every later turn comes from a simulated
  `user` (below), on one `thread_id` so the checkpointer carries the conversation. There are
  deliberately **no scripted turns** — a script answers the question the author guessed. Grade the
  **consequence** (what ended up in the DB) rather than the conversation: whether it asked is a
  claim with many spellings, and there is no judge.
- **Simulated users** (`eval/simulatedUser.mts` — the ONLY file importing `openevals`): a case may
  add a `user`, a goal plus a closed fact sheet **derived from `FIXTURE`**, and the simulator
  answers the agent's questions from the second turn. Its `agenda` holds the user's own follow-ups
  (a correction, a second question), sent verbatim whenever the simulator would otherwise end.
  It exists because a scripted turn answers the question the case author _guessed_: when the agent asks something
  reasonable but unforeseen, the script answers a different one, so the suite ends up rewarding
  agents that guess over agents that ask — the inverse of the approval-gate design. The simulator
  model is pinned **separately** from the model under test (`SIMULATOR_MODEL`) at its default temperature
  and recorded in every report; changing it invalidates comparison with older reports. Two sentinels
  end a conversation: `###DONE###` (finished — graders run) and `###CANNOT_ANSWER###` (the agent
  asked for something outside the facts → inconclusive, naming the question so the fix is
  mechanical).
- **`inconclusive` is a third outcome**, distinct from pass/fail: the run produced no gradeable
  evidence, so graders are skipped, the pass@k denominator shrinks, and the build does **not**
  fail. Reserved for harness or case-authoring problems (five enumerated causes). "The agent did
  something wrong in a conversation" is always a plain **failure** — widening this tier is how it
  turns into a place to hide them.

### Authoring skills (`.agents/`, not `skills/`)

Two different things share the word "skill": `skills/` is Cameron's own, committed and shipped
(see [docs/SKILLS.md](docs/SKILLS.md)); `.agents/skills/` is gitignored developer tooling that shapes
how this repo's code gets written. Tool conventions here follow
[`tool-design`](https://github.com/agentailor/skills) — reinstall with:

```bash
npx skills add agentailor/skills --skill tool-design
```

## Tracing (OpenTelemetry)

Agent runs are traced as OTel GenAI spans and exported over OTLP to a backend the owner runs —
Phoenix by default. Full detail in [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md).

- **Off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set** (`src/lib/tracing/config.ts`). There is no
  default destination in code; the production compose stack points at its own `phoenix-prod`.
- **Content capture is a separate opt-in** (`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`).
  Off, no prompt, message, tool argument, tool result or error message leaves the process — only
  names, counts, timings and token usage. On, each `chat` span also gets
  `gen_ai.tool.definitions` (the tools offered on that call — they travel beside the prompt, so
  the prompt alone never shows them), normalized per provider by `toSemconvToolDefinitions`.
- **`GenAiTracer`** (`src/lib/tracing/genAiTracer.ts`) is a LangChain callback attached per
  request in `agentService.ts`. It spans the run (`invoke_agent`), each model call (`chat`) and
  each tool call (`execute_tool`) — never graph nodes or middleware — and records the approval
  gate as an event (tool names only) and the resume's approve/reject counts.
- **`semconv.ts` is the only file naming `gen_ai.*` / `cameron.*` attributes.** The conventions are
  still Development stability; isolate any rename there.
- **`src/instrumentation.ts`** starts the Node SDK with the OTLP/proto exporter. It must live in
  `src/`: with an `src/app` layout the production build only looks there (a root-level file still
  runs under `pnpm dev`, which hides the gap). Next.js adds its own route and `fetch` spans to the
  same trace.
- No vendor SDK: Langfuse, Jaeger or anything OTLP is an endpoint change, not a code change.

## OpenAPI / API Docs

Machine-readable OpenAPI 3.1 spec generated from per-route Zod schemas — see [docs/API.md](docs/API.md).

- **`src/lib/api/openapi/`**: `zod.ts` (re-exports `z` after `extendZodWithOpenApi` — import `z` from here), `registry.ts` (shared `OpenAPIRegistry`), `routes.ts` (barrel importing every route's `schema.ts` for its `registerPath` side effects), `document.ts` (`buildOpenApiDocument()` with doc metadata), `common.ts` (shared `ErrorResponse`/`UploadErrorResponse`/`SuccessResponse`)
- **Co-located pattern**: each route has a sibling `schema.ts` defining Zod schemas (`.openapi("Name")`) and calling `registry.registerPath(...)`; the handler validates input with `.safeParse()`. When adding a route, also add its import to `routes.ts`
- **Served at**: `/api/openapi` (JSON via `src/app/api/openapi/route.ts`) and `/api-docs` (Scalar viewer via `src/app/api-docs/route.ts`)
- Validate the spec: `curl /api/openapi -o openapi.json && npx @redocly/cli lint openapi.json` (config in `redocly.yaml` — disables `security-defined` since the template has no API auth)

## Important Notes

- After editing `src/lib/database/schema.ts`, run `pnpm db:generate` then `pnpm db:migrate` (or `pnpm db:push` in dev)
- Access the DB only through the repository layer (`src/lib/repositories/`) — never import Drizzle in routes/services
- MCP server changes apply from the next message (the agent is rebuilt per message)
- Ports are distinct from the `fullstack-langgraph-nextjs-agent` template (which uses 3000 / 5434 /
  9000 / 9001) so both can run side by side: web **3100**, Postgres **5544**, MinIO API **9100**,
  MinIO Console **9101**. The compose project name is pinned to `cameron-ai` (container names
  `cameron-ai-db` / `cameron-ai-minio`) to avoid name collisions.
- Uses pnpm as package manager (see packageManager in package.json)
