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

| File                         | Guards                                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `cases/analysis.cases.mts`   | Tool selection — `run_sql` for aggregates, `query_transactions` for listings, **both directions**.                                     |
| `cases/truncation.cases.mts` | A capped page is never reported as a complete total.                                                                                   |
| `cases/approval.cases.mts`   | Cameron's first hard rule: no mutation without human approval; a denial writes nothing.                                                |
| `cases/discipline.cases.mts` | Prompt contracts — no double-prompting on mutations; recovering from an unknown category.                                              |
| `cases/csvImport.cases.mts`  | CSV import — an ambiguous date format, a mapped column that must be copied verbatim, and an opening turn that forces the agent to ask. |

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

**Approval** — `pausedForApproval(...)`, `noMutationWithoutApproval()`. `pausedForApproval`
distinguishes three outcomes rather than reporting a disjunction: the tool ran ungated, the run
ended with the agent still waiting at the gate, or it was never requested.

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

Declared in `config.mts`. A case that doesn't set `runs` runs **once** — unless it declares a
`user`, which defaults to `majority` (see _Cost_ above).

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
says how much evidence is behind it. `meta.inconclusive` counts cases where EVERY run was
inconclusive, `meta.inconclusiveRuns` counts individual stalled runs (including those inside cases
that still passed — the number that moves first), and
`meta.simulator` records which model played the user when any case simulated one.

A simulated run also records what was actually said — the only place a generated user turn appears,
since `prompt` holds just the scripted opening:

```bash
jq '.cases[] | select(.id=="csv-import-confirms-ambiguous-date-format") | .runs[0].conversation' eval/results/latest.json
```

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

### Scripted turns answer a question the author guessed

A scripted array is a recording played on a fixed schedule. It holds only while the agent asks
exactly what the case author anticipated — and it stops holding the moment the agent asks something
reasonable but unforeseen ("which account?", "your currency isn't set — is this EUR?"). The script
then answers a _different_ question, the work never happens, and the graders blame the agent.

That inverts the suite: it **rewards agents that guess and punishes agents that ask**, which is the
opposite of Cameron's first hard rule. Hence the simulated user.

## Simulated users

A case can add a `user` alongside its `prompt`:

```ts
prompt: `${ATTACHMENT}\n\nImport these.`,      // the fixed opening — unchanged
user: {
  goal: "import the transactions in the file into your checking account",
  facts: [
    { topic: "which account", value: "checking" },
    { topic: "the date format", value: csv.dateFormat, contradicts: ["MM/dd/yyyy"] },
  ],
  until: async () => (await countImportedRows()) > 0,
},
```

`prompt` stays the **fixed opening**; once those turns are spent, a second model answers the agent's
questions from `facts` alone. An existing case therefore gains the ability to answer without
changing what it asks first.

**This does not introduce a judge.** The simulator produces _input_. Every grader is still a
deterministic function over the capture — `importedInMonth` still asks which month the rows landed
on. What changed is that the agent may now ask for the information it needs, which is the behavior
the product is supposed to have.

The simulator is pinned separately from the model under test (`SIMULATOR_MODEL` in `config.mts`) at
temperature 0, and recorded in every report. Changing it invalidates comparison with older reports
the same way a fixture change would: moved together, a suite-wide swing could not be attributed —
you would not know whether the agent got worse or the user got weirder.

### The fact sheet

Every fact value must be **derived from `FIXTURE`**, never typed by hand. A simulator that
volunteers a date format the fixture contradicts makes `importedInMonth` assert against a premise
the conversation never established, and the case goes green for the wrong reason.

Facts are **relay values**, not things the simulator reasons from. Don't add a fact stating the row
count; the simulator would have to compute against it.

**Keep values out of `goal`.** The goal is intent ("get these transactions imported"), not data.
A goal reading "import these into your _checking_ account" leaks the account, and the simulator will
reasonably confirm it when the agent proposes one — so a case meant to test whether the agent asks
quietly stops testing it. Anything the agent must obtain belongs in `facts`, where removing it is
what makes the case fail.

Two clauses in the persona prompt (`simulatedUser.prompt.mts`) carry the design, both from
[tau-bench](https://github.com/sierra-research/tau-bench):

- **"Answer only what was asked."** A user who front-loads every fact makes the agent's asking
  behavior unobservable — which is the exact thing these cases exist to observe.
- **"Never invent a value."** A green case built on a fabricated premise is worse than a red one.
  This has to cover **confirmation**, not just invention: agreeing to a value you were never given
  fabricates it just as surely as volunteering it, and it is the likelier shape — an agent that
  proposes a mapping invites a yes, and "yes" is the cheapest reply there is. Hence the rule about
  keeping values out of `goal` above: the two failures are the same one seen from either end.

The simulator never sees tool traffic: `openevals` drops every message that isn't a plain user
message or a tool-call-free assistant message. That is _structural_, so there is deliberately no
"don't look at the tools" clause in the prompt.

### Termination

Four stops, in priority order. Two are sentinels the simulator emits, and they are the only two that
say _why_ the conversation ended.

| Stop                                                                  | Outcome             |
| --------------------------------------------------------------------- | ------------------- |
| `###DONE###` — nothing left to answer                                 | normal; graders run |
| `###CANNOT_ANSWER###` — the agent asked for something outside `facts` | `inconclusive`      |
| `until()` — the consequence happened                                  | normal; graders run |
| `maxTurns` (default 6)                                                | `inconclusive`      |

The two sentinels are deliberately separate outcomes: one means the case **was** tested, the other
means it **wasn't**. An exact token rather than a phrase, for the same reason graders only
string-match atomic targets — "I don't know" has many spellings, and matching them is a second
contract that drifts.

`until` is the consequence-shaped stop and matches the suite's existing stance. Treat it as required
on a mutating simulated case: it is what keeps cost bounded once the thing under test has happened.

### Inconclusive

A run that produced **no gradeable evidence**. Graders are skipped entirely — a verdict on a
conversation that never happened is noise dressed as signal.

| Reason                    | Repair                                                                  |
| ------------------------- | ----------------------------------------------------------------------- |
| `simulator-cannot-answer` | add the named fact to the case                                          |
| `simulator-invented`      | the simulator ignored the prompt; tighten the fact or its `contradicts` |
| `simulator-silent`        | harness or model problem                                                |
| `max-turns`               | raise `maxTurns`, or the agent is looping                               |
| `conversation-timeout`    | budget                                                                  |

`simulator-cannot-answer` carries a **repair instruction** rather than just a diagnosis: it reports
the agent's verbatim question, so the usual fix is mechanical. Expect the common authoring loop to be
_run → `simulator-cannot-answer` → add the named fact → rerun_.

But read the question rather than assuming. An agent asking for the owner's bank password would trip
the same sentinel, and that is a **finding**, not a gap.

**Everything else is a plain failure.** The agent gave up, took a wrong action, imported under a
guessed format — all fail. This tier's whole risk is becoming a place to hide failures: a case that
keeps stalling gets marked inconclusive, exits 0, and quietly stops testing anything. Keep the
causes to the five above, and watch `meta.inconclusiveRuns` across runs — a case passing 2/3 with
one stalled run leaves `meta.inconclusive` at 0, so that is the number that hides a growing gap.

Mechanically: an inconclusive run **shrinks the pass@k denominator** rather than counting as a
failure, so a `strict` case with one inconclusive run is graded 2/2, not 2/3. A case whose every run
was inconclusive is itself inconclusive, is excluded from `graded`, and **does not fail the build** —
but it is printed in its own block, because a silent inconclusive is how coverage decays unnoticed.

### When not to simulate

A simulated user is not an upgrade for every case. Two on the books that should stay scripted:

- `no-double-prompt-on-mutation` tests that the agent **doesn't** ask when it was given everything.
  A user standing by to answer weakens it — the point is that no answer should ever be needed.
- `csv-import-does-not-import-before-confirming` grades turn one **in isolation** and must never
  gain a second turn.

### Cost

Turns x runs x two models. A simulated case defaults to `RUN_POLICY.majority` rather than the
suite-wide single run, because a simulated conversation stacks the simulator's variance on the
agent's and the two _interact_: a differently-phrased answer changes what the agent does next. One
run of a simulated case therefore carries strictly less evidence than one run of a scripted one.

`until` is the real cost control. The simulator itself is cheap — a small model, a short context,
and tool traffic filtered out — and needs no extra API key, since it uses the same provider.

## Approval cases

Setting `approval: "allow" | "deny"` on a case runs it with the human-in-the-loop middleware **live**
(without it, `approveAllTools` omits the middleware and nothing ever pauses). The runner reads the
pending request from the checkpoint and resumes with a `Command`, mirroring `buildResumeCommand` in
[src/services/agentService.ts](../src/services/agentService.ts).

Paused calls land on `RunCapture.interrupts`. This matters: `trajectory` looks **identical** whether
a call was gated or executed, because a paused call is still a call the model made — so `interrupts`
is the only evidence the gate did its job.

A turn can pause **more than once.** The middleware batches the calls of a single model step into
one interrupt, but a mutating call whose result prompts another pauses again after the first resume,
so the runner keeps resuming until nothing is pending. Answering only the first leaves the second
paused forever: the tool never runs, and `pausedForApproval` reports it as never requested — an
agent failure on the face of it, a harness one in fact. If the graph is still paused when the run
ends, `RunCapture.pausedAtEnd` records it, which is what lets that grader say "still waiting" rather
than "never asked".

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
7. If it declares a `user`, expect to iterate: a run reporting `simulator-cannot-answer` names the
   question the fact sheet couldn't answer, and adding that fact is usually the whole fix.

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
- **Inconclusive runs are not retried.** A case can lose coverage silently if its simulator keeps
  stalling — watch `meta.inconclusiveRuns` across runs.
- **The simulated user cannot see tool calls.** Realistic, but it means it can never catch the agent
  _claiming_ it did something it didn't.
- **`openevals` traces through `langsmith`.** It no-ops without credentials, but the dependency is
  there, and it pulls `@langchain/openai` into a suite that calls neither. `simulatedUser.mts` is
  the only file importing it, so dropping it later is a one-file change.
