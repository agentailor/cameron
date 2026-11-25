import type { RunStatus, RunUpdate, StatusWrite } from "./types";

/**
 * Allowed transitions. `done` and `failed` are terminal. A paused run goes back to `running`
 * when the app resumes it, or straight to an outcome if the app only records the result.
 */
const TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  running: ["paused", "done", "failed"],
  paused: ["running", "paused", "done", "failed"],
  done: [],
  failed: [],
};

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** The statuses a run may be in for a move to `to` — the store's compare-and-set guard. */
export function allowedFrom(to: RunStatus): RunStatus[] {
  return (Object.keys(TRANSITIONS) as RunStatus[]).filter((from) => canTransition(from, to));
}

export function isTerminal(status: RunStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** The row write for an update: every status-specific field set or cleared. */
export function toStatusWrite(update: RunUpdate, now: Date): StatusWrite {
  switch (update.status) {
    case "running":
      return { status: "running", pauseReason: undefined, error: undefined, finishedAt: undefined };
    case "paused":
      return {
        status: "paused",
        pauseReason: update.reason,
        error: undefined,
        finishedAt: undefined,
      };
    case "done":
      return { status: "done", pauseReason: undefined, error: undefined, finishedAt: now };
    case "failed":
      return { status: "failed", pauseReason: undefined, error: update.error, finishedAt: now };
  }
}
