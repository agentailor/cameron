import { randomUUID } from "node:crypto";
import { HumanMessage } from "@langchain/core/messages";
import {
  DEFAULT_MAX_CONCURRENT_RUNS,
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
import {
  continuationOf,
  outcomeOf,
  taskMessage,
  taskThreadTitle,
  type RunSnapshot,
} from "./outcome";
import { isRetryableTaskError, toTaskError } from "./errors";
import { toPolicy } from "./limits";
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
  // First, so a missing model fails before a thread is created.
  const agent = await ensureAgent();
  const { threadId, continuing } = await threadFor(task, run, ctx);
  const config = {
    configurable: { thread_id: threadId },
    signal: ctx.signal,
    ...(tracingEnabled() ? { callbacks: [new GenAiTracer()] } : {}),
  };

  const step = continuing ? continuationOf(await snapshotOf(agent, threadId)) : "start";
  try {
    if (step === "start") {
      await agent.invoke({ messages: [new HumanMessage(taskMessage(task))] }, config);
    } else if (step === "resume") {
      await agent.invoke(null, config); // from the last checkpoint
    }
  } catch (error) {
    throw toTaskError(error);
  }
  return outcomeOf(await snapshotOf(agent, threadId));
};

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
    policy: async (name) => {
      const [global, setting] = await Promise.all([readGlobalLimits(), taskRepo.getSetting(name)]);
      return toPolicy(setting?.limits, global);
    },
    maxConcurrentRuns: async () =>
      (await readGlobalLimits()).maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS,
    isRetryable: isRetryableTaskError,
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
