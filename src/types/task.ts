/** The `/api/tasks` wire shapes. Zero imports, so client components can use them. */

export interface TaskView {
  name: string;
  description: string;
  schedule: string;
  /** The zone the schedule is read in. */
  timezone: string;
  enabled: boolean;
  /** Next occurrence, ISO; null while the task is off. */
  nextRunAt: string | null;
  /** The owner's overrides for this task; null uses the global value. */
  limits: { timeoutMinutes: number | null; maxRetries: number | null };
}

/** Global limits: what the owner set (null = default), and the defaults. */
export interface TaskLimitsView {
  set: {
    maxConcurrentRuns: number | null;
    timeoutMinutes: number | null;
    maxRetries: number | null;
  };
  defaults: { maxConcurrentRuns: number; timeoutMinutes: number; maxRetries: number };
}

export type TaskRunStatus = "running" | "paused" | "done" | "failed";

export interface TaskRunView {
  id: string;
  taskName: string;
  slot: string;
  trigger: "schedule" | "manual";
  status: TaskRunStatus;
  /** Attempts used: retries and recoveries after a crash add one. */
  attempts: number;
  pauseReason: string | null;
  error: string | null;
  /** The thread the run wrote to. */
  threadId: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface TasksResponse {
  tasks: TaskView[];
  runs: TaskRunView[];
  limits: TaskLimitsView;
}
