import { randomUUID } from "node:crypto";
import { HumanMessage } from "@langchain/core/messages";
import {
  allowedFrom,
  createScheduler,
  toStatusWrite,
  type Scheduler,
  type TaskExecutor,
} from "@agentailor/agent-tasks";
import { ensureAgent } from "@/lib/agent";
import * as threadRepo from "@/lib/repositories/threadRepository";
import * as taskRepo from "@/lib/repositories/taskRepository";
import { GenAiTracer } from "@/lib/tracing/genAiTracer";
import { tracingEnabled } from "@/lib/tracing/config";
import { defaultTimezone, listTasks } from "./registry";
import { isGrantable } from "./grants";
import * as grantRepo from "@/lib/repositories/toolGrantRepository";
import {
  continuationOf,
  outcomeOf,
  permanentFailureOf,
  taskMessage,
  taskThreadTitle,
  type RunSnapshot,
} from "./outcome";
import { readGlobalLimits } from "./settings";

/** How long a shutdown waits for runs before aborting them; under Docker's 10 s stop timeout. */
export const STOP_GRACE_MS = 8_000;

/**
 * Cameron's side of `@agentailor/agent-tasks`: a task run is the same agent, with the same
 * approval gate, on a new thread. SERVER ONLY. See docs/TASKS.md.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Agent = any;

async function snapshotOf(agent: Agent, threadId: string): Promise<RunSnapshot> {
  return agent.graph.getState({ configurable: { thread_id: threadId } });
}

type ExecutorArgs = Parameters<TaskExecutor>;

/** The thread to write to: the earlier attempt's, unless there was none or the owner deleted it. */
async function threadFor(
  task: ExecutorArgs[0],
  run: ExecutorArgs[1],
  ctx: ExecutorArgs[2],
): Promise<{ threadId: string; continuing: boolean }> {
  if (ctx.previousRef && (await threadRepo.getById(ctx.previousRef))) {
    return { threadId: ctx.previousRef, continuing: true };
  }
  const threadId = randomUUID();
  await threadRepo.create({ id: threadId, title: taskThreadTitle(task, run) });
  await ctx.attachRef(threadId);
  return { threadId, continuing: false };
}

export const executeTask: TaskExecutor = async (task, run, ctx) => {
  try {
    return await runOnThread(task, run, ctx);
  } catch (error) {
    // Thrown errors are retried by the package; these would only fail again.
    const failure = permanentFailureOf(error);
    if (failure) return failure;
    throw error;
  }
};

/**
 * The tools a run may use without approval: the owner's grants for its task, fixed when the run
 * starts. Its retries and resumes reuse them, so a grant changed while it is paused can't change
 * the step it paused on; a change applies from the next run.
 */
async function grantsForRun(taskName: string, runId: string): Promise<string[]> {
  const fixed = await taskRepo.getRunGrants(runId);
  if (fixed) return fixed;
  const stored = await grantRepo.listTools({ kind: "task", id: taskName });
  const grants = stored.filter(isGrantable);
  await taskRepo.setRunGrants(runId, grants);
  return grants;
}

/**
 * A task's grants for a chat turn on its thread (the owner approving a paused run, say): the
 * continued turn is still the task's work. None once the run is finished, and none elsewhere.
 */
export async function grantsForThread(threadId: string): Promise<string[]> {
  const run = await taskRepo.findOpenRunByThread(threadId);
  return run ? grantsForRun(run.taskName, run.id) : [];
}

async function runOnThread(...[task, run, ctx]: ExecutorArgs) {
  // First, so a missing model fails before a thread is created.
  const agent = await ensureAgent({ preApprovedTools: await grantsForRun(task.name, run.id) });
  const { threadId, continuing } = await threadFor(task, run, ctx);
  const config = {
    configurable: { thread_id: threadId },
    signal: ctx.signal,
    ...(tracingEnabled() ? { callbacks: [new GenAiTracer()] } : {}),
  };

  const step = continuing ? continuationOf(await snapshotOf(agent, threadId)) : "start";
  if (step === "start") {
    await agent.invoke({ messages: [new HumanMessage(taskMessage(task))] }, config);
  } else if (step === "resume") {
    await agent.invoke(null, config); // from the last checkpoint
  }
  return outcomeOf(await snapshotOf(agent, threadId));
}

// One per process, shared by instrumentation (the loop) and routes (Run now): Next.js bundles
// them separately, so a module-level variable would make two.
const GLOBAL_KEY = Symbol.for("cameron.taskScheduler");
type WithScheduler = typeof globalThis & { [GLOBAL_KEY]?: Scheduler };

export function getScheduler(): Scheduler {
  const g = globalThis as WithScheduler;
  g[GLOBAL_KEY] ??= createScheduler({
    tasks: listTasks,
    store: taskRepo.taskStore,
    execute: executeTask,
    defaultTimezone: defaultTimezone(),
    // The task's own value, else the one for all tasks; undefined leaves the package default.
    policy: async (name) => {
      const [global, setting] = await Promise.all([readGlobalLimits(), taskRepo.getSetting(name)]);
      const minutes = setting?.limits.timeoutMinutes ?? global.timeoutMinutes;
      return {
        timeoutMs: minutes === undefined ? undefined : minutes * 60_000,
        maxRetries: setting?.limits.maxRetries ?? global.maxRetries,
      };
    },
    maxConcurrentRuns: async () => (await readGlobalLimits()).maxConcurrentRuns,
    onError: (error, { phase, runId }) =>
      console.error(`[tasks] ${phase} failed${runId ? ` (run ${runId})` : ""}:`, error),
  });
  return g[GLOBAL_KEY];
}

export function startScheduler(): void {
  getScheduler().start();
}

/** Graceful shutdown: let runs finish briefly, abort the rest (recovered on the next start). */
export async function stopScheduler(): Promise<void> {
  await getScheduler().stop(STOP_GRACE_MS);
}

/**
 * After a chat turn on a task's thread (the owner approving, say), record where its run now
 * stands. A thread no open run wrote to is left alone.
 */
export async function syncTaskRun(agent: Agent, threadId: string): Promise<void> {
  const run = await taskRepo.findOpenRunByThread(threadId);
  if (!run) return;
  const outcome = outcomeOf(await snapshotOf(agent, threadId));
  await taskRepo.updateStatus(
    run.id,
    allowedFrom(outcome.status),
    toStatusWrite(outcome, new Date()),
  );
}
