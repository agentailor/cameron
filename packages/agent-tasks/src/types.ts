/** A task, as read from its `TASK.md`. */
export interface TaskDefinition {
  /** Kebab-case, identical to its directory name. */
  name: string;
  description: string;
  /** Five-field cron expression (minute granularity). */
  schedule: string;
  /** IANA time zone the schedule is read in; falls back to the scheduler's default. */
  timezone?: string;
  /** The file's body: the brief the agent is given. */
  brief: string;
}

/** A task directory that exists but could not be loaded. Always reported. */
export interface TaskFailure {
  dir: string;
  error: string;
}

export type TaskFileResult = { ok: true; task: TaskDefinition } | { ok: false; error: string };

export type RunStatus = "running" | "paused" | "done" | "failed";
export type RunTrigger = "schedule" | "manual";

export interface TaskRun {
  id: string;
  taskName: string;
  /** The cron occurrence this run answers; for a manual run, when it was asked for. */
  slot: Date;
  trigger: RunTrigger;
  status: RunStatus;
  /** Why it is paused, in the app's words (e.g. "approval"). */
  pauseReason?: string;
  error?: string;
  /** App-defined pointer to what the run produced, e.g. a thread id. */
  ref?: string;
  /** When the current attempt started. */
  startedAt: Date;
  finishedAt?: Date;
  /** 1 for the first attempt; a retry or a recovery after a restart adds one. */
  attempts: number;
}

/** What an executor reports when it returns. */
export type ExecutionOutcome =
  | { status: "done" }
  | { status: "paused"; reason: string }
  | { status: "failed"; error: string };

/** A change the app records later, e.g. after a paused run is resumed in a chat. */
export type RunUpdate = { status: "running" } | ExecutionOutcome;

export interface ExecutionContext {
  /** Record `ref` on the run now, so it survives an executor that later throws. */
  attachRef(ref: string): Promise<void>;
  /** Aborted when the attempt times out or the scheduler stops. Pass it to anything cancellable. */
  signal: AbortSignal;
  /** 1 for the first attempt. */
  attempt: number;
  /**
   * The ref an earlier attempt attached, when this attempt is a retry or a recovery after a
   * restart. The executor decides whether to continue from it or start over.
   */
  previousRef?: string;
}

export type TaskExecutor = (
  task: TaskDefinition,
  run: TaskRun,
  ctx: ExecutionContext,
) => Promise<ExecutionOutcome>;

/** A task the owner turned on, and since when: slots before `enabledAt` never run. */
export interface TaskEnablement {
  taskName: string;
  enabledAt: Date;
}

export interface NewRun {
  taskName: string;
  slot: Date;
  trigger: RunTrigger;
  startedAt: Date;
}

/** How one task runs. Defaults in `DEFAULT_TASK_POLICY`; the app overrides per task. */
export interface TaskPolicy {
  /** An attempt still going after this is aborted and the run failed. */
  timeoutMs: number;
  /** Extra attempts after a retryable error (see `isRetryable`). 0 = never retry. */
  maxRetries: number;
  /** `skip`: don't start a slot while the task has a run still running or paused. */
  overlap: "skip" | "allow";
}

/** Fields written with a status change. `undefined` clears a field. */
export interface StatusWrite {
  status: RunStatus;
  pauseReason?: string;
  error?: string;
  finishedAt?: Date;
}

/** Persistence the scheduler needs. The app implements it over its own database. */
export interface TaskStore {
  listEnablements(): Promise<TaskEnablement[]>;
  /** Insert a `running` run unless one exists for (taskName, slot). Must be atomic. */
  claimRun(input: NewRun): Promise<TaskRun | null>;
  attachRef(runId: string, ref: string): Promise<void>;
  /** Compare-and-set: write only if the run's status is one of `from`. False otherwise. */
  updateStatus(runId: string, from: readonly RunStatus[], write: StatusWrite): Promise<boolean>;
  /** Whether the task has a run that is `running` or `paused`. */
  hasOpenRun(taskName: string): Promise<boolean>;
  /** Every `running` run, oldest first. */
  listRunning(): Promise<TaskRun[]>;
  /**
   * Start a new attempt: compare-and-set on the run still being `running` with this
   * `startedAt`, so two callers can't both take it over. False otherwise.
   */
  restartRun(
    runId: string,
    expectedStartedAt: Date,
    write: { startedAt: Date; attempts: number },
  ): Promise<boolean>;
}

export interface Clock {
  now(): Date;
}
