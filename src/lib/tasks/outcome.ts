import type { ExecutionOutcome, TaskDefinition, TaskRun } from "@agentailor/agent-tasks";
import { readPendingBatch, type GraphSnapshot } from "@/services/approvalDecisions";

/**
 * Pure helpers for running a task on the agent. Free of I/O so they test without a database.
 */

/** Where a run stands once the agent stops: waiting on the approval gate, or finished. */
export function outcomeOf(snapshot: GraphSnapshot): ExecutionOutcome {
  if (readPendingBatch(snapshot).actionRequests.length > 0) {
    return { status: "paused", reason: "approval" };
  }
  const interrupted = snapshot.tasks?.some((t) => (t.interrupts ?? []).length > 0);
  return interrupted ? { status: "paused", reason: "interrupt" } : { status: "done" };
}

/** A checkpoint snapshot, with the nodes the graph would run next. */
export type RunSnapshot = GraphSnapshot & { next?: readonly string[] };

/**
 * What a retry or a recovered run does with the thread an earlier attempt left:
 * - `start`: nothing was saved (it failed before the first step), so send the brief;
 * - `resume`: the graph stopped between steps, so continue from the last checkpoint;
 * - `settled`: it already finished or paused; only the outcome is left to record.
 */
export function continuationOf(snapshot: RunSnapshot): "start" | "resume" | "settled" {
  if ((snapshot.values?.messages ?? []).length === 0) return "start";
  if (snapshot.tasks?.some((t) => (t.interrupts ?? []).length > 0)) return "settled";
  return (snapshot.next ?? []).length > 0 ? "resume" : "settled";
}

/** The first message of a task's thread: who is (not) there, then the task's own brief. */
export function taskMessage(task: TaskDefinition): string {
  return [
    `Scheduled task: ${task.name}. The owner is not here; they will read this thread later.`,
    "Anything that needs their approval waits for them. Don't ask questions they can't answer now:" +
      " if something you need is missing, say what it is and stop.",
    "",
    task.brief,
  ].join("\n");
}

export function taskThreadTitle(task: TaskDefinition, run: TaskRun): string {
  return `${task.name} · ${run.slot.toISOString().slice(0, 10)}`;
}
