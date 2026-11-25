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
    const run: TaskRun = { id: `run-${++this.seq}`, status: "running", attempts: 1, ...input };
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

  async hasOpenRun(taskName: string) {
    return this.runs.some(
      (r) => r.taskName === taskName && (r.status === "running" || r.status === "paused"),
    );
  }

  async listRunning() {
    return this.runs
      .filter((r) => r.status === "running")
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
      .map((r) => ({ ...r }));
  }

  async restartRun(
    runId: string,
    expectedStartedAt: Date,
    write: { startedAt: Date; attempts: number },
  ) {
    const run = this.runs.find((r) => r.id === runId);
    if (!run || run.status !== "running") return false;
    if (run.startedAt.getTime() !== expectedStartedAt.getTime()) return false;
    Object.assign(run, write);
    return true;
  }

  /** A run as a previous process might have left it. */
  seed(run: Partial<TaskRun> & Pick<TaskRun, "taskName" | "startedAt">): TaskRun {
    const full: TaskRun = {
      id: `run-${++this.seq}`,
      slot: run.startedAt,
      trigger: "schedule",
      status: "running",
      attempts: 1,
      ...run,
    };
    this.runs.push(full);
    return full;
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
