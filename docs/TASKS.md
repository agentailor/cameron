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
---

The brief: what the agent should do.
```

A task without `timezone` uses the server's (`TZ`, else the system zone). In the Docker image that
is UTC unless `TZ` is set.

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
3. runs the agent to completion with `invoke`, then reads the checkpoint: a pending approval is
   `paused` (`reason: "approval"`), anything else `done`. An exception is `failed`.

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
due slot runs after downtime. The package defaults apply (10 min timeout, 1 retry, at most 3 runs at
once, no overlapping runs of one task), and a run left `running` by a restart is recovered on the
next tick. Cameron does not yet pass the abort signal to the agent, continue a retry from its thread,
or let the owner change these limits: that is the next change.

## Not yet

**Each approval stops the run.** A run pauses at the first gated step, and nothing after it
happens until the owner answers. A task that needs several writes can cost several round trips,
each one only after the previous approval. The gate already puts every gated call from _one_ model
step into one batch (one card per call, sent together), so independent writes cost a single
pause, but only if the model requests them in the same step. Ideas to revisit:

- cheapest: ask, in the task framing, for independent writes to be requested together in one step;
- collect proposed writes without pausing and present them all at the end. Harder: later steps
  can't assume an unapproved write happened, and a denial sends the whole step back by design;
- pre-approved read-only tools per task (below) reduce pauses but never cover writes.

Also not built:

Per-task tool scoping, `requires` (pause when an MCP server is missing or unauthenticated), an
`ask_owner` pause for questions, pre-approved read-only tools per task, and the agent creating
schedules itself.
