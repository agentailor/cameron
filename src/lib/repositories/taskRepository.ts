import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
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
import type { TaskLimits } from "@/lib/tasks/limits";

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
    attempts: row.attempts,
  };
}

function column(date: Date): string {
  return toColumnTimestamp(date.toISOString())!;
}

export interface TaskSetting {
  taskName: string;
  enabled: boolean;
  enabledAt: Date | null;
  /** The owner's overrides; absent uses the global value, then the default. */
  limits: TaskLimits;
}

type SettingRow = typeof taskSettings.$inferSelect;

function toSetting(row: SettingRow): TaskSetting {
  return {
    taskName: row.taskName,
    enabled: row.enabled,
    enabledAt: row.enabledAt ? columnToDate(row.enabledAt) : null,
    limits: {
      ...(row.timeoutMinutes !== null ? { timeoutMinutes: row.timeoutMinutes } : {}),
      ...(row.maxRetries !== null ? { maxRetries: row.maxRetries } : {}),
    },
  };
}

export async function listSettings(): Promise<TaskSetting[]> {
  return (await db.select().from(taskSettings)).map(toSetting);
}

export async function getSetting(taskName: string): Promise<TaskSetting | null> {
  const [row] = await db.select().from(taskSettings).where(eq(taskSettings.taskName, taskName));
  return row ? toSetting(row) : null;
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
  return toSetting(row);
}

/** Set or clear (null) a task's overrides. A task never toggled is created off. */
export async function setLimits(
  taskName: string,
  limits: { timeoutMinutes?: number | null; maxRetries?: number | null },
): Promise<TaskSetting> {
  const now = column(new Date());
  const set = {
    ...(limits.timeoutMinutes !== undefined ? { timeoutMinutes: limits.timeoutMinutes } : {}),
    ...(limits.maxRetries !== undefined ? { maxRetries: limits.maxRetries } : {}),
    updatedAt: now,
  };
  const [row] = await db
    .insert(taskSettings)
    .values({ taskName, enabled: false, enabledAt: null, ...set })
    .onConflictDoUpdate({ target: taskSettings.taskName, set })
    .returning();
  return toSetting(row);
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

export async function hasOpenRun(taskName: string): Promise<boolean> {
  const rows = await db
    .select({ id: taskRuns.id })
    .from(taskRuns)
    .where(and(eq(taskRuns.taskName, taskName), inArray(taskRuns.status, ["running", "paused"])))
    .limit(1);
  return rows.length > 0;
}

export async function listRunning(): Promise<TaskRun[]> {
  const rows = await db
    .select()
    .from(taskRuns)
    .where(eq(taskRuns.status, "running"))
    .orderBy(asc(taskRuns.startedAt), asc(taskRuns.id));
  return rows.map(toDomain);
}

export async function restartRun(
  runId: string,
  expectedStartedAt: Date,
  write: { startedAt: Date; attempts: number },
): Promise<boolean> {
  const rows = await db
    .update(taskRuns)
    .set({ startedAt: column(write.startedAt), attempts: write.attempts })
    .where(
      and(
        eq(taskRuns.id, runId),
        eq(taskRuns.status, "running"),
        eq(taskRuns.startedAt, column(expectedStartedAt)),
      ),
    )
    .returning({ id: taskRuns.id });
  return rows.length > 0;
}

export const taskStore: TaskStore = {
  listEnablements,
  claimRun,
  attachRef,
  updateStatus,
  hasOpenRun,
  listRunning,
  restartRun,
};
