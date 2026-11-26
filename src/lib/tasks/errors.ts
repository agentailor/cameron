import { AGENT_RECURSION_LIMIT } from "@/lib/agent/recursion";

/**
 * Which task failures are worth another attempt. Pure, so it tests without the agent.
 *
 * Errors are matched by `name` and `status`, never `instanceof`: under tsx and Next, LangGraph can
 * load twice (ESM and CJS), giving two classes for one error.
 */

/** A failure that would fail the same way again. */
export class PermanentTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentTaskError";
  }
}

const PERMANENT_NAMES = new Set([
  "PermanentTaskError",
  "ModelNotConfiguredError",
  "ModelSettingsError",
  "AbortError",
]);

/** Client errors a retry can't fix: a bad request, a bad key, a missing model. 429 isn't one. */
const PERMANENT_STATUSES = new Set([400, 401, 403, 404, 422]);

function statusOf(error: unknown): number | undefined {
  const e = error as { status?: unknown; response?: { status?: unknown } } | null;
  const status = e?.status ?? e?.response?.status;
  return typeof status === "number" ? status : undefined;
}

export function isRetryableTaskError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  if (PERMANENT_NAMES.has(error.name)) return false;
  const status = statusOf(error);
  return status === undefined || !PERMANENT_STATUSES.has(status);
}

/** What the run records for an error thrown by the agent: readable, and permanent if it is. */
export function toTaskError(error: unknown): unknown {
  if (error instanceof Error && error.name === "GraphRecursionError") {
    return new PermanentTaskError(`Ran out of steps (limit ${AGENT_RECURSION_LIMIT}).`);
  }
  return error;
}
