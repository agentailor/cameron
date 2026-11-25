import type {
  Clock,
  NewRun,
  RunStatus,
  StatusWrite,
  TaskDefinition,
  TaskEnablement,
  TaskRun,
  TaskStore,
} from "./types";

/** In-memory `TaskStore` for tests, honouring the same contract a database store must. */
export class MemoryTaskStore implements TaskStore {
  runs: TaskRun[] = [];
  enablements: TaskEnablement[] = [];
  private seq = 0;

  enable(taskName: string, enabledAt: Date): void {
    this.enablements.push({ taskName, enabledAt });
  }

  async listEnablements() {
    return [...this.enablements];
  }

  async claimRun(input: NewRun) {
    const taken = this.runs.some(
      (r) => r.taskName === input.taskName && r.slot.getTime() === input.slot.getTime(),
    );
    if (taken) return null;
    const run: TaskRun = { id: `run-${++this.seq}`, status: "running", ...input };
    this.runs.push(run);
    return { ...run };
  }

  async attachRef(runId: string, ref: string) {
    const run = this.runs.find((r) => r.id === runId);
    if (run) run.ref = ref;
  }

  async updateStatus(runId: string, from: readonly RunStatus[], write: StatusWrite) {
    const run = this.runs.find((r) => r.id === runId);
    if (!run || !from.includes(run.status)) return false;
    Object.assign(run, write);
    return true;
  }

  async failStaleRuns(before: Date, write: { error: string; finishedAt: Date }) {
    let count = 0;
    for (const run of this.runs) {
      if (run.status === "running" && run.startedAt.getTime() < before.getTime()) {
        Object.assign(run, { status: "failed", ...write });
        count++;
      }
    }
    return count;
  }
}

export class FakeClock implements Clock {
  constructor(private current: Date) {}
  now() {
    return new Date(this.current);
  }
  set(iso: string) {
    this.current = new Date(iso);
  }
}

export function makeTask(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    name: "weekly-digest",
    description: "A weekly summary.",
    schedule: "0 8 * * MON",
    brief: "Summarize last week.",
    ...overrides,
  };
}
