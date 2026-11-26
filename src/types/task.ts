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
  /** Tools the owner lets this task run without approval. */
  grantedTools: string[];
  /** The tools the task's file declares (`tools`), offered as suggested grants; a hint only. */
  suggestedGrants: string[];
}

/** `GET /api/tasks/{name}/grants`: every tool the task could be granted. */
export interface GrantsView {
  task: string;
  /** Cameron's own writes. `risk` is null for one that can never be granted. */
  builtIn: {
    tool: string;
    risk: "adds" | "changes" | "bulk" | null;
    grantable: boolean;
    granted: boolean;
    suggested: boolean;
  }[];
  /** Each enabled server's tools, from its stored catalog. */
  servers: {
    server: string;
    tools: {
      tool: string;
      name: string;
      /** The server's own readOnlyHint (a claim), or null when it says nothing. */
      readOnly: boolean | null;
      granted: boolean;
      suggested: boolean;
    }[];
  }[];
  /** Granted or suggested tools not found now (a server off or removed). */
  missing: { tool: string; granted: boolean; suggested: boolean }[];
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
