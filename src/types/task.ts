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
}

export type TaskRunStatus = "running" | "paused" | "done" | "failed";

export interface TaskRunView {
  id: string;
  taskName: string;
  slot: string;
  trigger: "schedule" | "manual";
  status: TaskRunStatus;
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
}
