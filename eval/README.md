# Evals

Programmatic regression evals for Cameron. They drive the **real agent** against a **sandbox
Postgres**, then grade what it did with plain functions — no eval library, no LLM judge.

Unlike `pnpm test`, these are **slow, paid, and non-deterministic**. They are never part of CI.

## Running

```bash
docker compose -f compose.eval.yaml up -d   # sandbox stack (Postgres 5545, MinIO 9110) — once
cp .env.eval.example .env.eval              # then add your ANTHROPIC_API_KEY
pnpm eval                                   # every case
```

| Command               | What it does                                                                      |
| --------------------- | --------------------------------------------------------------------------------- |
| `pnpm eval`           | All cases. Most run once; a few repeat (see _Run policy_).                        |
| `pnpm eval approval`  | Only cases matching `approval` — by **id substring or tag**.                      |
| `pnpm eval -v`        | Print per-run timing, the tool trajectory, and anything the approval gate paused. |
| `pnpm typecheck:eval` | Typecheck the eval tree. Free — the root `tsc` misses it (see below).             |

Two env vars change what a run does. **`VAR=value pnpm eval` is bash syntax and does NOT work in
PowerShell** — there is no inline env-var prefix, so the assignment is passed as an argument and the
run silently does the wrong thing (the runner now detects this and tells you). On Windows:

```powershell
$env:EVAL_MODE="fast"; pnpm eval          # force 1 run per case, collapsing the repeats
$env:EVAL_MODEL="claude-sonnet-5"; pnpm eval
Remove-Item Env:EVAL_MODE                 # clear it again — $env: persists for the session
```

```bash
EVAL_MODE=fast pnpm eval                  # bash/zsh
```

> Set these in your shell, **not** in `.env.eval` — a value left in that file silently applies to
> every future run. `EVAL_MODEL` is validated against a known-model list so a stale or mistyped
> value fails immediately instead of after a full suite.

Teardown: `docker compose -f compose.eval.yaml down -v`.

Seeded data is left in place after a run so a failure stays inspectable; the next run wipes it.

> **`db.mts` will refuse to run against any database not named `cameron_eval`.** Evals TRUNCATE,
> and the dev stack is one port away.

## What these cover that `pnpm test` cannot

Unit tests ([docs/TESTING.md](../docs/TESTING.md)) assert on the JSON a tool returns. They prove
`truncated: true` is _in the payload_. They cannot prove the agent **noticed** it — that it didn't
sum a capped page and state the figure as a yearly total. Nor can they catch **mis-selection**
between two plausible tools, or a mutation escaping the approval gate. Those need a model in the
loop.

So a case earns its place by guarding a **defect class**, not by exercising a feature:

| File                         | Guards                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `cases/analysis.cases.mts`   | Tool selection — `run_sql` for aggregates, `query_transactions` for listings, **both directions**. |
| `cases/truncation.cases.mts` | A capped page is never reported as a complete total.                                               |
| `cases/approval.cases.mts`   | Cameron's first hard rule: no mutation without human approval; a denial writes nothing.            |
| `cases/discipline.cases.mts` | Prompt contracts — no double-prompting on mutations; recovering from an unknown category.          |
| `cases/csvImport.cases.mts`  | CSV import — an ambiguous date format, and a mapped column that must be copied verbatim.           |

## The fixture

`seed.mts` seeds three categories and some income. The sizes are load-bearing:

- **Dining (262 rows)** deliberately exceeds `query_transactions`' 200-row cap, so any attempt to
  total it by listing **must** truncate. That trap is the truncation case.
- **Groceries (40)** and **Transport (12)** stay under the cap and have distinct totals, so
  "biggest category" has one correct answer.

Every expected figure is **derived from the same formula that seeds the rows** and exposed on
`FIXTURE`. Never hardcode a total in a case: a hardcoded constant goes stale the moment the fixture
changes, and then the eval fails for the wrong reason.

`seed()` also uploads a small **CSV fixture** to the eval object store for the import cases. It is
built to make a wrong import _detectable_: dates are `dd/MM/yyyy` with a day ≤ 12, so `05/07/2026`
is valid under both readings (5 July vs 7 May) and a wrong format imports cleanly with no error —
only the stored month differs. Its category header is accented (`Catégorie`) and its type column is
French, so a translated mapping is rejected and English type defaults do not apply.

## Graders

All deterministic, all in `graders.mts`. `grade()` may be async (one grader reads the DB back).

**Trajectory** — `toolCalled(...)`, `toolNotCalled(...)`, `toolCallCountAtMost(name, n)`,
`sqlMatches(regex)`

**Answer text** — `statesAmount(n)`, `statesNoWrongTotal(n)`, `statesCount(n)`

**Approval** — `pausedForApproval(...)`, `noMutationWithoutApproval()`

**Ground truth** — `rowCountInStore(table, n)` (async; reads the sandbox DB),
`toolResultMatches(name, predicate, opts)` (reads what the agent actually _saw_)

**Imported data** (async; all read the sandbox DB) — `importedRowCount(n)`,
`importedInMonth(month, wrongMonth)`, `importedCategories(...names)`, plus
`toolCalledWith(name, predicate, label)` for asserting a chosen argument

### Two rules for writing a case

**1. No vacuous passes.** A negative grader alone is satisfied by a run that did nothing —
`toolNotCalled("run_sql")` passes when the agent errored, refused, or answered from thin air. Always
pair one with a positive grader that proves the work happened.

**2. Atomic targets only.** There is no LLM judge here, so a string assertion is only correct when
its target has exactly **one valid spelling** — a figure (`2733.00`), a tool name, a count. A
_claim_ ("acknowledged the denial", "named a real category") has combinatorially many correct
spellings; asserting one of them passes by luck and fails on harmless rewording. Assert the
structural fact instead — what tool was called, what is in the database.

This is why a finance agent can stay judge-free where a RAG agent cannot: the thing under assertion
is usually a number.

## Run policy (pass@k)

Declared in `config.mts`. A case that doesn't set `runs` runs **once**.

| Policy     | Runs      | Use for                                                            |
| ---------- | --------- | ------------------------------------------------------------------ |
| `single`   | 1         | The default. A structural assertion that is near-deterministic.    |
| `majority` | 3, need 2 | Behavior known to vary run to run.                                 |
| `strict`   | 3, need 3 | A wrong outcome that is silent, unrecoverable, or both.            |
| `fast`     | 1         | `EVAL_MODE=fast` only — forces one run everywhere while iterating. |

### Why repeat a case at all

The same prompt can pass once and fail the next time. That is not noise to be averaged away — it is
a property of the system under test, and sometimes it is the finding.

A case in this suite demonstrated it. Asked about a category that doesn't exist, `run_sql` returns
SQL `NULL` — indistinguishable from a category that exists with no spending. One run stopped there
and guessed, answering _"you don't have any transactions categorized as Entertainment yet"_, which
wrongly implies the category exists. A rerun of the same prompt called `list_categories` and
answered correctly.

Either run alone would have misled: the first says "broken", the second says "fine". The pair says
**recovery is intermittent** — roughly a coin flip on a plausible-but-wrong answer. That is the
actionable version, and only repetition produces it.

### Choosing n and k

`pass@k` means: run `n` times, require `k` passes. Two knobs, two different questions.

- **`n`** is how much evidence you buy. Three is a reasonable starter — enough to catch a coin-flip
  behavior, cheap enough to run often. Raise it when you are specifically measuring stability
  (does this flip 1 time in 10?), not as a general setting.
- **`k`** encodes how much a failure costs. `k = n` (unanimous) for outcomes that are silent or
  unrecoverable — a mutation escaping the approval gate, a CSV imported on the wrong dates. `k` at a
  majority for behavior that varies legitimately, where you want the common case to be right.

### Why the default here is 1

Repeats buy information only where behavior is actually unstable. Most cases here assert something
structural and near-deterministic — did the gate pause, did the rows land in July — and running
those three times spends three times as much to learn the same thing.

A project that **gates merges** on its evals would default the other way, because there an
unrepeated green cannot be told apart from a lucky one. This suite is a teaching artifact and gates
nothing, so repeats are opt-in per case, and each `runs:` says in a comment why it earned one.

## Reports

Every run writes to `eval/results/` (gitignored):

- **`latest.html`** — the run as a standalone page. Open it straight from disk; the data is inlined,
  so there is no server, no file picker, and no external requests. Failures sort to the top.
- **`latest.json`** — a stable path, so anything can read the last run without globbing.
- **`report-<timestamp>.json`** — the same content, kept as history.

The console output scrolls away and can't be diffed or attached to a bug report; a run is slow and
paid, so the artifact should outlive the terminal. Each case records its per-run grader verdicts
(with failure reasons), the tool trajectory, anything the approval gate paused, and the agent's
final answer — enough to diagnose a failure without re-running.

```bash
jq '.meta' eval/results/latest.json                                  # model, mode, pass counts
jq '[.cases[] | select(.passed | not) | .id]' eval/results/latest.json   # what failed
jq '.cases[] | select(.id == "denied-expense-writes-nothing")' eval/results/latest.json
```

`meta.mode` records whether repeats ran or `EVAL_MODE=fast` collapsed them, so a report always
says how much evidence is behind it.

## Multi-turn cases

A case's `prompt` may be an array. Turns replay in order on one `thread_id`, so the Postgres
checkpointer carries the conversation — no message history is rebuilt by hand. Each invoke returns
the whole thread, so the runner collects only what is new; otherwise earlier tool calls would be
counted again on every turn.

Use it wherever the behavior under test is the agent **stopping to ask** — a single turn cannot
express the user's answer. CSV import is the current example: it must confirm an ambiguous date
format before writing anything.

Grade the **consequence, not the conversation.** Whether the agent asked is a claim with many
phrasings, and there is no judge here; what it did afterwards is a fact in the database.

## Approval cases

Setting `approval: "allow" | "deny"` on a case runs it with the human-in-the-loop middleware **live**
(without it, `approveAllTools` omits the middleware and nothing ever pauses). The runner reads the
pending request from the checkpoint and resumes with a `Command`, mirroring `buildResumeCommand` in
[src/services/agentService.ts](../src/services/agentService.ts).

Paused calls land on `RunCapture.interrupts`. This matters: `trajectory` looks **identical** whether
a call was gated or executed, because a paused call is still a call the model made — so `interrupts`
is the only evidence the gate did its job.

Approval cases mutate, so `run.mts` re-seeds the fixture before **each** run.

## Adding a case

1. Pick the file matching the defect class (or add one and export it from `cases/index.mts`).
2. Give it `tags` — the CLI filter matches on id **or** tag, so a case whose name doesn't happen to
   contain the filter word is still selected. Untagged cases are only reachable by id substring.
3. Read expected figures from `FIXTURE` — never hardcode.
4. Pair every negative grader with a positive one, and keep string assertions atomic.
5. `pnpm typecheck:eval`, then run just that case in fast mode (see _Running_) with `-v` to see the
   trajectory.
6. Confirm it can **fail**: a case that has never been observed red is not known to test anything.

Use `skip: true` with a comment rather than deleting a known-red case — a skipped case with a
recorded reason is a tracked finding; a deleted one is lost.

## Known gaps

- **Attachments are simulated, not uploaded through the app.** CSV cases put the reference the
  chat route would inject (`[Attached file: … fileKey: …]`) straight in the prompt; the upload
  endpoint itself is not exercised.
- **The SSE/service layer is bypassed.** Evals call `getAgent()` directly, so streaming, thread
  persistence, and attachment handling are out of scope.
- **The root `tsconfig.json` does not cover this tree** — its `include` is `**/*.ts`, which doesn't
  match `.mts`. Hence `eval/tsconfig.json` and `pnpm typecheck:eval`.
- **No run-over-run diff.** Each run writes a report (below), but nothing compares two of them yet.
