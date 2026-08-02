# Testing

Cameron has unit tests today. Evals are coming in a future version; how they'll be implemented
will be documented once they exist.

```bash
pnpm test          # run once — free, offline, no DB
pnpm test:watch    # watch mode
```

## CI

`.github/workflows/ci.yml` runs `pnpm test` + `tsc --noEmit` on every PR and push to `main`.
`release.yml` runs the same on a `v*` tag and only publishes the GitHub Release if they pass —
so a tag can never ship a red suite.

## The rule: `pnpm test` is always free

No model calls, no network, no database, no API keys. That is what makes it safe to run on every
change and in CI. A test that needs any of those belongs in the eval layer, not here.

This is verifiable: stop Postgres (`docker compose stop`) and the suite still passes.

## Layout: tests beside the code

Test files sit next to what they test — `finance.test.ts` beside `finance.ts`. A tool and its
test form a self-contained unit that can be lifted into another project, which matters because
the pattern comes from the portable
[`tool-design`](https://github.com/agentailor/skills) skill: "write the tool, write its test
beside it" shouldn't require adopting this repo's directory structure.

Evals will live in their own top-level tree with their own config and scripts, since they are
cross-cutting (they exercise the whole agent, not one module) and paid. `pnpm test` stays
unit-only and free regardless.

## What the tool tests assert

Tool tests assert on the **JSON payload the tool returns**, using the `callTool` helper in
[`src/lib/agent/tools/testing.ts`](../src/lib/agent/tools/testing.ts). Repositories are stubbed
with `vi.mock`, so no Postgres is required. Asserting on the payload — rather than on internals —
means these assertions stay valid when an eval layer grades the same surface later.

### The defect class these exist to catch

**A tool description is a contract with a non-deterministic caller, and nothing else verifies that
the implementation honors it.**

The worked example, and the reason this suite exists: `query_transactions` used to return
`count: items.length` — the number of rows _returned_ — while the repository silently capped at 200. A filter matching 847 transactions came back as `count: 200` with no indication anything was
missing. The agent cannot distinguish that from a complete result, and the system prompt
encourages it to reason over those rows. In a finance agent, that is a confidently-stated wrong
total.

Nothing would have caught it. The fix (`returned` / `matched` / `truncated` + a `hint`) is locked
in by a test that was **observed failing first**.

Concretely, tool tests check that:

- truncation is **signalled**, not just applied — and the payload says how to continue
- errors return **structured, actionable objects** rather than throwing
- the payload contains the fields the description **promises**
- "no results" means what the agent will read it to mean (an unknown category is reported as
  unknown, not as "you have no transactions")
- paths that would silently lose data **fail loud and import nothing** (a CSV mapping naming a
  column that isn't a real header; an ambiguous date format)

## Why unit tests are not enough

A unit test proves `truncated: true` is present in the payload. It cannot prove the agent
_noticed_ it — that it didn't sum a capped page and report the figure as the year's total. Nor can
it catch mis-selection between two plausible tools (`query_transactions` vs `run_sql`).

Those failures need a model in the loop, which is the eval layer. Deferring evals is a resource
decision, not a statement that the risk is absent: the truncation bug was found by reading, not by
a signal.

## Adding a test

- **Pure logic** (`sqlGuard`, `csv`) — import and call it. No mocks.
- **A tool** — `vi.mock` the repositories it imports, then use `callTool(tool, input)` and assert
  on the parsed payload. Fixtures (`makeTransaction`, `makeCategory`) live in
  [`testing.ts`](../src/lib/agent/tools/testing.ts).

When adding a **new tool**, add its test beside it in the same commit. If the tool can truncate,
fail, or return an empty result, each of those paths needs a case — they are where agents actually
get misled.
