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
import type { GraphSnapshot } from "@/services/approvalDecisions";
import { defaultTimezone, listTasks } from "./registry";
import { outcomeOf, taskMessage, taskThreadTitle } from "./outcome";

/**
 * Cameron's side of `@agentailor/agent-tasks`: a task run is the same agent, with the same
 * approval gate, on a new thread. SERVER ONLY. See docs/TASKS.md.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Agent = any;

async function snapshotOf(agent: Agent, threadId: string): Promise<GraphSnapshot> {
  return agent.graph.getState({ configurable: { thread_id: threadId } });
}

export const executeTask: TaskExecutor = async (task, run, ctx) => {
  const threadId = randomUUID();
  await threadRepo.create({ id: threadId, title: taskThreadTitle(task, run) });
  await ctx.attachRef(threadId);

  const agent = await ensureAgent();
  await agent.invoke(
    { messages: [new HumanMessage(taskMessage(task))] },
    {
      configurable: { thread_id: threadId },
      ...(tracingEnabled() ? { callbacks: [new GenAiTracer()] } : {}),
    },
  );
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
    onError: (error, { phase, runId }) =>
      console.error(`[tasks] ${phase} failed${runId ? ` (run ${runId})` : ""}:`, error),
  });
  return g[GLOBAL_KEY];
}

export function startScheduler(): void {
  getScheduler().start();
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
