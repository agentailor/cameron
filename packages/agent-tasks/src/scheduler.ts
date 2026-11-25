import { allowedFrom, toStatusWrite } from "./lifecycle";
import { latestDueSlot } from "./schedule";
import type {
  Clock,
  ExecutionOutcome,
  RunUpdate,
  TaskDefinition,
  TaskExecutor,
  TaskRun,
  TaskStore,
} from "./types";

export const DEFAULT_INTERVAL_MS = 60_000;
export const DEFAULT_RUN_TIMEOUT_MS = 30 * 60_000;
export const STALE_RUN_ERROR = "The run did not finish: it was still running when it timed out.";

export type SchedulerErrorPhase = "tick" | "execute" | "record";

export interface SchedulerOptions {
  /** The task definitions, or a function returning them on each tick. */
  tasks: TaskDefinition[] | (() => TaskDefinition[]);
  store: TaskStore;
  execute: TaskExecutor;
  clock?: Clock;
  /** Zone for tasks that name none. Default `UTC`. */
  defaultTimezone?: string;
  intervalMs?: number;
  /** A `running` run older than this is failed as stale (e.g. after a crash). */
  runTimeoutMs?: number;
  onError?: (error: unknown, context: { phase: SchedulerErrorPhase; runId?: string }) => void;
}

export type RunNowResult = { ok: true; run: TaskRun } | { ok: false; error: "unknown_task" };

export interface Scheduler {
  /** One pass: expire stale runs, then claim and start every due slot. Returns the runs started. */
  tick(): Promise<TaskRun[]>;
  start(): void;
  /** Stop ticking and wait for in-flight runs. */
  stop(): Promise<void>;
  /** Start a task now, enabled or not. */
  runNow(taskName: string): Promise<RunNowResult>;
  /** Record a later change, e.g. a paused run resumed by the app. False if the move isn't allowed. */
  update(runId: string, update: RunUpdate): Promise<boolean>;
  /** Resolves when no run started by this scheduler is still executing. */
  idle(): Promise<void>;
}

const systemClock: Clock = { now: () => new Date() };

export function createScheduler(opts: SchedulerOptions): Scheduler {
  const clock = opts.clock ?? systemClock;
  const defaultTimezone = opts.defaultTimezone ?? "UTC";
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const runTimeoutMs = opts.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  const report = opts.onError ?? (() => {});
  const inFlight = new Set<Promise<void>>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let ticking: Promise<TaskRun[]> | undefined;

  const definitions = () => (typeof opts.tasks === "function" ? opts.tasks() : opts.tasks);

  async function record(runId: string, update: RunUpdate): Promise<boolean> {
    return opts.store.updateStatus(
      runId,
      allowedFrom(update.status),
      toStatusWrite(update, clock.now()),
    );
  }

  function launch(task: TaskDefinition, run: TaskRun): void {
    const job = (async () => {
      let outcome: ExecutionOutcome;
      try {
        outcome = await opts.execute(task, run, {
          attachRef: (ref) => opts.store.attachRef(run.id, ref),
        });
      } catch (e) {
        report(e, { phase: "execute", runId: run.id });
        outcome = { status: "failed", error: e instanceof Error ? e.message : String(e) };
      }
      try {
        await record(run.id, outcome);
      } catch (e) {
        report(e, { phase: "record", runId: run.id });
      }
    })();
    inFlight.add(job);
    void job.finally(() => inFlight.delete(job));
  }

  async function pass(): Promise<TaskRun[]> {
    const now = clock.now();
    await opts.store.failStaleRuns(new Date(now.getTime() - runTimeoutMs), {
      error: STALE_RUN_ERROR,
      finishedAt: now,
    });

    const byName = new Map(definitions().map((t) => [t.name, t]));
    const started: TaskRun[] = [];
    for (const { taskName, enabledAt } of await opts.store.listEnablements()) {
      const task = byName.get(taskName);
      if (!task) continue; // enabled, but its file is gone
      const slot = latestDueSlot(task.schedule, {
        now,
        timezone: task.timezone ?? defaultTimezone,
        notBefore: enabledAt,
      });
      if (!slot) continue;
      const run = await opts.store.claimRun({
        taskName,
        slot,
        trigger: "schedule",
        startedAt: now,
      });
      if (!run) continue; // this slot already ran, here or in another process
      launch(task, run);
      started.push(run);
    }
    return started;
  }

  const scheduler: Scheduler = {
    tick() {
      // One pass at a time; an overlapping call shares the pass in progress.
      ticking ??= pass().finally(() => {
        ticking = undefined;
      });
      return ticking;
    },

    start() {
      if (timer) return;
      const safeTick = () => {
        scheduler.tick().catch((e) => report(e, { phase: "tick" }));
      };
      safeTick();
      timer = setInterval(safeTick, intervalMs);
      timer.unref?.();
    },

    async stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      await ticking?.catch(() => {});
      await scheduler.idle();
    },

    async runNow(taskName) {
      const task = definitions().find((t) => t.name === taskName);
      if (!task) return { ok: false, error: "unknown_task" };
      const now = clock.now();
      const run = await opts.store.claimRun({
        taskName,
        slot: now,
        trigger: "manual",
        startedAt: now,
      });
      if (!run) throw new Error(`A run of "${taskName}" already exists for ${now.toISOString()}.`);
      launch(task, run);
      return { ok: true, run };
    },

    update: record,

    async idle() {
      while (inFlight.size > 0) await Promise.all([...inFlight]);
    },
  };
  return scheduler;
}
