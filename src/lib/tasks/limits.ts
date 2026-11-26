import type { TaskPolicy } from "@agentailor/agent-tasks";

/**
 * Task limits the owner sets on /tasks. A zero-import leaf (types only), so the page can share the
 * bounds. Stored in `config` under keys absent from the agent's catalog: Cameron can't read or
 * change its own limits. See docs/TASKS.md.
 */

export type LimitField = "maxConcurrentRuns" | "timeoutMinutes" | "maxRetries";

export const TASK_LIMIT_KEYS: Record<LimitField, string> = {
  maxConcurrentRuns: "tasks_max_concurrent_runs",
  timeoutMinutes: "tasks_timeout_minutes",
  maxRetries: "tasks_max_retries",
};

/** Must equal the package defaults (pinned by a test). */
export const LIMIT_DEFAULTS: Record<LimitField, number> = {
  maxConcurrentRuns: 3,
  timeoutMinutes: 10,
  maxRetries: 1,
};

export const LIMIT_LABELS: Record<LimitField, string> = {
  maxConcurrentRuns: "Runs at once",
  timeoutMinutes: "Timeout",
  maxRetries: "Retries",
};

export const LIMIT_BOUNDS: Record<LimitField, { min: number; max: number }> = {
  maxConcurrentRuns: { min: 1, max: 10 },
  timeoutMinutes: { min: 1, max: 24 * 60 },
  maxRetries: { min: 0, max: 5 },
};

/** Values the owner set; an absent field uses the next layer down. */
export type Limits = Partial<Record<LimitField, number>>;
/** Per task: only timeout and retries. */
export type TaskLimits = Partial<Record<"timeoutMinutes" | "maxRetries", number>>;

export type LimitCheck = { ok: true; value: number | null } | { ok: false; error: string };

/** `null` or `""` clears the field (use the default); anything else must be a whole number in bounds. */
export function parseLimit(field: LimitField, raw: unknown): LimitCheck {
  if (raw === null || raw === "") return { ok: true, value: null };
  const value = typeof raw === "string" ? Number(raw) : raw;
  const { min, max } = LIMIT_BOUNDS[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    return {
      ok: false,
      error: `${LIMIT_LABELS[field]} must be a whole number from ${min} to ${max}.`,
    };
  }
  return { ok: true, value };
}

/** The task's own value, else the owner's global one, else the default. */
export function effectiveLimit(
  field: LimitField,
  task: Limits | undefined,
  global: Limits,
): number {
  return task?.[field] ?? global[field] ?? LIMIT_DEFAULTS[field];
}

export function toPolicy(task: TaskLimits | undefined, global: Limits): Partial<TaskPolicy> {
  return {
    timeoutMs: effectiveLimit("timeoutMinutes", task, global) * 60_000,
    maxRetries: effectiveLimit("maxRetries", task, global),
  };
}
