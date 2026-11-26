import * as configRepo from "@/lib/repositories/configRepository";

/**
 * The owner's task limits for all tasks, in `config` under keys absent from the agent's catalog:
 * Cameron can't read or change its own limits. Unset means the package default. SERVER ONLY.
 */

export interface GlobalLimits {
  maxConcurrentRuns?: number;
  timeoutMinutes?: number;
  maxRetries?: number;
}

const KEYS: Record<keyof GlobalLimits, string> = {
  maxConcurrentRuns: "tasks_max_concurrent_runs",
  timeoutMinutes: "tasks_timeout_minutes",
  maxRetries: "tasks_max_retries",
};
const FIELDS = Object.keys(KEYS) as (keyof GlobalLimits)[];

export async function readGlobalLimits(): Promise<GlobalLimits> {
  const rows = await Promise.all(FIELDS.map((f) => configRepo.get(KEYS[f])));
  const limits: GlobalLimits = {};
  FIELDS.forEach((field, i) => {
    const value = Number(rows[i]?.value);
    if (rows[i] && Number.isFinite(value)) limits[field] = value;
  });
  return limits;
}

/** Validated values: a number sets the field, null clears it, absent leaves it. */
export async function writeGlobalLimits(input: {
  [K in keyof GlobalLimits]?: number | null;
}): Promise<GlobalLimits> {
  for (const field of FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    if (value === null) await configRepo.remove(KEYS[field]);
    else await configRepo.set(KEYS[field], String(value));
  }
  return readGlobalLimits();
}
