import * as configRepo from "@/lib/repositories/configRepository";
import { TASK_LIMIT_KEYS, parseLimit, type LimitField, type Limits } from "./limits";

/** The owner's global task limits, in `config`. SERVER ONLY. */

const FIELDS = Object.keys(TASK_LIMIT_KEYS) as LimitField[];

/** Only the values the owner set; a stored value that no longer parses is ignored. */
export async function readGlobalLimits(): Promise<Limits> {
  const rows = await Promise.all(FIELDS.map((f) => configRepo.get(TASK_LIMIT_KEYS[f])));
  const limits: Limits = {};
  FIELDS.forEach((field, i) => {
    const parsed = parseLimit(field, rows[i]?.value ?? null);
    if (parsed.ok && parsed.value !== null) limits[field] = parsed.value;
  });
  return limits;
}

/** Already-parsed values: a number sets the field, null clears it, absent leaves it. */
export async function writeGlobalLimits(input: Partial<Record<LimitField, number | null>>) {
  for (const field of FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    if (value === null) await configRepo.remove(TASK_LIMIT_KEYS[field]);
    else await configRepo.set(TASK_LIMIT_KEYS[field], String(value));
  }
  return readGlobalLimits();
}
