import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type {
  NewRun,
  RunStatus,
  RunTrigger,
  StatusWrite,
  TaskEnablement,
  TaskRun,
  TaskStore,
} from "@agentailor/agent-tasks";
import db from "@/lib/database/db";
import { taskRuns, taskSettings } from "@/lib/database/schema";
import { columnToDate, toColumnTimestamp } from "@/lib/database/timestamps";

/**
 * Persistence for scheduled tasks: the owner's on/off choice per task, and every run. The ONLY ORM
 * seam for `task_setting` and `task_run`; it is also the `TaskStore` the scheduler runs on.
 * A run's `ref` is the thread it wrote to (`thread_id`).
 */

type RunRow = typeof taskRuns.$inferSelect;

function toDomain(row: RunRow): TaskRun {
  return {
    id: row.id,
    taskName: row.taskName,
    slot: columnToDate(row.slot),
    trigger: row.trigger as RunTrigger,
    status: row.status as RunStatus,
    ...(row.pauseReason ? { pauseReason: row.pauseReason } : {}),
    ...(row.error ? { error: row.error } : {}),
    ...(row.threadId ? { ref: row.threadId } : {}),
    startedAt: columnToDate(row.startedAt),
    ...(row.finishedAt ? { finishedAt: columnToDate(row.finishedAt) } : {}),
  };
}

function column(date: Date): string {
  return toColumnTimestamp(date.toISOString())!;
}

export interface TaskSetting {
  taskName: string;
  enabled: boolean;
  enabledAt: Date | null;
}

export async function listSettings(): Promise<TaskSetting[]> {
  const rows = await db.select().from(taskSettings);
  return rows.map((r) => ({
    taskName: r.taskName,
    enabled: r.enabled,
    enabledAt: r.enabledAt ? columnToDate(r.enabledAt) : null,
  }));
}

/** Turning a task on starts its clock now, so slots missed while it was off never run. */
export async function setEnabled(taskName: string, enabled: boolean): Promise<TaskSetting> {
  const now = column(new Date());
  const values = { taskName, enabled, enabledAt: enabled ? now : null, updatedAt: now };
  const [row] = await db
    .insert(taskSettings)
    .values(values)
    .onConflictDoUpdate({ target: taskSettings.taskName, set: values })
    .returning();
  return {
    taskName: row.taskName,
    enabled: row.enabled,
    enabledAt: row.enabledAt ? columnToDate(row.enabledAt) : null,
  };
}

/** Most recent first. */
export async function listRuns(options: { limit?: number } = {}): Promise<TaskRun[]> {
  const rows = await db
    .select()
    .from(taskRuns)
    .orderBy(desc(taskRuns.startedAt), desc(taskRuns.id))
    .limit(options.limit ?? 50);
  return rows.map(toDomain);
}

/** The paused or running run that wrote to this thread, if any. */
export async function findOpenRunByThread(threadId: string): Promise<TaskRun | null> {
  const rows = await db
    .select()
    .from(taskRuns)
    .where(and(eq(taskRuns.threadId, threadId), inArray(taskRuns.status, ["paused", "running"])))
    .limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

// --- TaskStore ---

export async function listEnablements(): Promise<TaskEnablement[]> {
  const settings = await listSettings();
  return settings
    .filter((s) => s.enabled && s.enabledAt)
    .map((s) => ({ taskName: s.taskName, enabledAt: s.enabledAt! }));
}

export async function claimRun(input: NewRun): Promise<TaskRun | null> {
  const [row] = await db
    .insert(taskRuns)
    .values({
      id: randomUUID(),
      taskName: input.taskName,
      slot: column(input.slot),
      trigger: input.trigger,
      status: "running",
      startedAt: column(input.startedAt),
    })
    .onConflictDoNothing({ target: [taskRuns.taskName, taskRuns.slot] })
    .returning();
  return row ? toDomain(row) : null;
}

export async function attachRef(runId: string, ref: string): Promise<void> {
  await db.update(taskRuns).set({ threadId: ref }).where(eq(taskRuns.id, runId));
}

export async function updateStatus(
  runId: string,
  from: readonly RunStatus[],
  write: StatusWrite,
): Promise<boolean> {
  if (from.length === 0) return false;
  // Every field is written, so an absent one clears the column (Drizzle skips `undefined`).
  const rows = await db
    .update(taskRuns)
    .set({
      status: write.status,
      pauseReason: write.pauseReason ?? null,
      error: write.error ?? null,
      finishedAt: write.finishedAt ? column(write.finishedAt) : null,
    })
    .where(and(eq(taskRuns.id, runId), inArray(taskRuns.status, [...from])))
    .returning({ id: taskRuns.id });
  return rows.length > 0;
}

export async function failStaleRuns(
  before: Date,
  write: { error: string; finishedAt: Date },
): Promise<number> {
  const rows = await db
    .update(taskRuns)
    .set({ status: "failed", error: write.error, finishedAt: column(write.finishedAt) })
    .where(and(eq(taskRuns.status, "running"), lt(taskRuns.startedAt, column(before))))
    .returning({ id: taskRuns.id });
  return rows.length;
}

export const taskStore: TaskStore = {
  listEnablements,
  claimRun,
  attachRef,
  updateStatus,
  failStaleRuns,
};
