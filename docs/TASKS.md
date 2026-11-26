# Scheduled tasks

Cameron can do work on a schedule while the owner is away: a weekly digest, say. A task is a file;
each run is the **same agent with the same approval gate** on a new thread; anything that would
change the records pauses until the owner approves it from `/tasks`.

The generic machinery (task files, cron slots, run lifecycle, the loop) is the workspace package
[`@agentailor/agent-tasks`](../packages/agent-tasks/README.md). This page covers Cameron's side.

## A task file

`tasks/<name>/TASK.md`, read once at startup (`src/lib/tasks/registry.ts`), like skills: adding or
editing one needs a restart. A broken file is logged and dropped; `shipped.test.ts` fails if a
committed one doesn't load.

```md
---
name: weekly-digest
description: Every Monday morning, a short summary of last week's spending.
schedule: "0 8 * * MON"
timezone: Europe/Paris # optional
tools: # optional: the tools it expects to use (docs/GRANTS.md)
  - gmail_search_messages
---

The brief: what the agent should do.
```

A task without `timezone` uses the server's (`TZ`, else the system zone). In the Docker image that
is UTC unless `TZ` is set.

## Grants

A task would stop on every write and every MCP call, like chat does, with nobody there to answer.
The owner can **grant** tools per task on `/tasks`, so they run without asking from the next run.
Cameron's own writes are grantable except `delete_transaction` (a hard delete); MCP tools are
granted one by one. The file's `tools` list only marks those tools as suggested. Full detail:
[GRANTS.md](GRANTS.md).

## Off until the owner turns it on

A file in the repo never spends money or touches data by itself. `task_setting` records the
owner's choice; enabling stores `enabled_at`, and slots before it never run, so turning a task on
on Wednesday doesn't immediately run Monday's digest. **Run now** works whether or not a task is
enabled.

## A run

`executeTask` (`src/lib/tasks/scheduler.ts`):

1. creates a thread titled `<task> · <date>` and records it on the run (`task_run.thread_id`)
   before calling the model, so a run that fails still links to what it wrote;
2. sends one message: a short framing (`taskMessage` in `outcome.ts`: the owner is away, approvals
   wait, don't ask questions, say what's missing and stop) followed by the brief verbatim;
3. runs the agent to completion with `invoke`, passing the attempt's `signal` so a timeout or a
   shutdown really stops it, then reads the checkpoint: a pending approval is `paused`
   (`reason: "approval"`), anything else `done`. An exception is `failed`, or retried (below).

The model is resolved first, so a missing model setup fails the run before any thread is made.

## Retries and recovery

A retry, or a run recovered after a restart, gets the earlier attempt's thread (`previousRef`)
and continues it instead of opening a new one. `continuationOf` reads that thread's checkpoint:

- nothing saved (it failed before the first step): send the brief again;
- stopped between steps: `invoke(null)`, which continues from the last checkpoint;
- already finished or paused: just record the outcome.

If the owner deleted that thread, the attempt starts on a new one.

The package retries what the executor **throws** and never what it **returns**. So the executor
returns the two failures another attempt would only repeat (`permanentFailureOf` in
`outcome.ts`): running out of steps ("Ran out of steps (limit 50).") and a missing model setup.
Everything else is thrown and retried. They are matched by name, not `instanceof`, because
LangGraph can load twice.

## Limits

Set on `/tasks`: **runs at once**, and the **timeout** (minutes) and **retries** every task
inherits; each task can override its own timeout and retries. An empty field means the next
layer down: the task's value, then the one for all tasks, then the package's default (3 runs,
10 min, 1 retry). Cameron passes `undefined` when neither is set and the package applies its
default; the page shows the package's own constants. They are read when a run starts, so a change
applies from the next run without a restart. The routes validate with their zod schemas (the same
ones in the OpenAPI spec), and the page shows the server's message.

The global values live in `config` (`tasks_*` keys), deliberately **outside the agent's settings
catalog**, like the model settings: Cameron can't read or change its own limits. A task's
overrides are `task_setting.timeout_minutes` / `max_retries`. API: `PUT /api/tasks` (global) and
`PUT /api/tasks/{name}` (one task; `null` clears). Run now returns 409 `busy` at the limit.

## Shutdown

In the Docker image, `NEXT_MANUAL_SIG_HANDLE=true` stops Next.js exiting on its own at SIGTERM.
`instrumentation.node.ts` then stops the scheduler: runs get 8 s (`STOP_GRACE_MS`, under
Docker's 10 s) to finish, the rest are aborted and left `running`, and the process exits. The
next start recovers them without counting the interrupted attempt. Under `pnpm dev` the variable
isn't set, so a stopped dev server leaves its runs as if it had crashed (recovered, but counted).

There is no approval bypass and no separate tool set: the run sees exactly the tools chat does.

## Resuming a paused run

The package never resumes. The owner opens the run's thread from **Waiting for you** on `/tasks`
and approves or denies on the usual card. After that turn streams, `streamResponse` calls
`syncTaskRun`, which re-reads the checkpoint and records `done` or `paused` again.

A paused thread shows its approval card on reload because `fetchThreadHistory` rebuilds
`pendingToolCallIds` from the checkpoint's pending interrupt (`getPendingInterrupts` +
`markPendingCalls`). Before this, the ids existed only on the live stream, so a paused thread
opened later had no buttons; chat threads get the same fix.

## The loop

`src/instrumentation.node.ts` starts it at server start (Node runtime only). One scheduler per
process, kept on `globalThis` because Next.js bundles instrumentation and route handlers
separately. It ticks every minute. A slot runs at most once because `task_run` is unique on
`(task_name, slot)`, so even a second process sharing the database can't run a slot twice.
Recovering interrupted runs is different: it assumes **one scheduler process per database**, since
a second live process could take over a run the first is still executing. Only the latest
due slot runs after downtime, a slot isn't started while the task's previous run is still open,
and a run left `running` by a restart is recovered on the next tick.

## Not yet

**Each approval stops the run.** A run pauses at the first gated step, and nothing after it
happens until the owner answers. A task that needs several writes can cost several round trips,
each one only after the previous approval. The gate already puts every gated call from _one_ model
step into one batch (one card per call, sent together), so independent writes cost a single
pause, but only if the model requests them in the same step. Ideas to revisit:

- cheapest: ask, in the task framing, for independent writes to be requested together in one step;
- collect proposed writes without pausing and present them all at the end. Harder: later steps
  can't assume an unapproved write happened, and a denial sends the whole step back by design;
- grants (above) remove pauses for granted tools, but never for built-in writes.

Also not built:

Per-task tool scoping (a `tools:` list limiting what a run can see), `requires` (pause when an
MCP server is missing or unauthenticated), an `ask_owner` pause for questions, and the agent
creating schedules itself.
