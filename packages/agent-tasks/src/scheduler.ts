import { allowedFrom, toStatusWrite } from "./lifecycle";
import { latestDueSlot } from "./schedule";
import type {
  Clock,
  ExecutionOutcome,
  RunUpdate,
  TaskDefinition,
  TaskExecutor,
  TaskPolicy,
  TaskRun,
  TaskStore,
} from "./types";

export const DEFAULT_TASK_POLICY: TaskPolicy = {
  timeoutMs: 10 * 60_000,
  maxRetries: 1,
  overlap: "skip",
};
export const DEFAULT_MAX_CONCURRENT_RUNS = 3;
export const DEFAULT_INTERVAL_MS = 60_000;
export const DEFAULT_RETRY_DELAY_MS = 30_000;
export const DEFAULT_STOP_GRACE_MS = 10_000;
export const TASK_GONE_ERROR = "The task's file is gone, so the run could not continue.";
/** setTimeout fires at once for anything larger (about 24.8 days). */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export function noRetriesLeftError(attempts: number): string {
  return `The process stopped during attempt ${attempts}, and no retries are left.`;
}

export type SchedulerErrorPhase = "tick" | "execute" | "record";

type MaybePromise<T> = T | Promise<T>;

export interface SchedulerOptions {
  /** The task definitions, or a function returning them on each tick. */
  tasks: TaskDefinition[] | (() => TaskDefinition[]);
  store: TaskStore;
  execute: TaskExecutor;
  clock?: Clock;
  /** Zone for tasks that name none. Default `UTC`. */
  defaultTimezone?: string;
  intervalMs?: number;
  /** Overrides of {@link DEFAULT_TASK_POLICY} for one task, read each time a run starts. */
  policy?: (taskName: string) => MaybePromise<Partial<TaskPolicy> | undefined>;
  /** Runs executing at once in this process, read on each tick. `undefined`: the default, 3. */
  maxConcurrentRuns?: number | (() => MaybePromise<number | undefined>);
  /** Whether a thrown error is worth another attempt. Default: every error. */
  isRetryable?: (error: unknown) => boolean;
  /** Wait before retry N is N × this. Default 30 s. */
  retryDelayMs?: number;
  /** For tests: how to wait between attempts. Must reject or resolve early when aborted. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  onError?: (error: unknown, context: { phase: SchedulerErrorPhase; runId?: string }) => void;
}

export type RunNowResult =
  | { ok: true; run: TaskRun }
  | { ok: false; error: "unknown_task" | "busy" };

export interface Scheduler {
  /**
   * One pass: recover runs a previous process left `running`, then claim and start due slots,
   * within the concurrency limit. Returns the runs started.
   */
  tick(): Promise<TaskRun[]>;
  start(): void;
  /**
   * Stop ticking, give in-flight runs `graceMs` to finish, then abort them. An aborted run stays
   * `running`, so the next process recovers it.
   */
  stop(graceMs?: number): Promise<void>;
  /** Start a task now, enabled or not. `busy` at the concurrency limit. */
  runNow(taskName: string): Promise<RunNowResult>;
  /** Record a later change, e.g. a paused run resumed by the app. False if the move isn't allowed. */
  update(runId: string, update: RunUpdate): Promise<boolean>;
  /** Resolves when no run started by this scheduler is still executing. */
  idle(): Promise<void>;
}

const systemClock: Clock = { now: () => new Date() };

const TIMEOUT = Symbol("timeout");
const SHUTDOWN = Symbol("shutdown");

type AttemptResult =
  | { kind: "outcome"; outcome: ExecutionOutcome }
  | { kind: "error"; error: unknown }
  | { kind: "timeout" }
  | { kind: "shutdown" };

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export function formatDuration(ms: number): string {
  if (ms % 60_000 === 0) return `${ms / 60_000} min`;
  if (ms % 1000 === 0) return `${ms / 1000} s`;
  return `${ms} ms`;
}

export function createScheduler(opts: SchedulerOptions): Scheduler {
  const clock = opts.clock ?? systemClock;
  const defaultTimezone = opts.defaultTimezone ?? "UTC";
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const isRetryable = opts.isRetryable ?? (() => true);
  const report = opts.onError ?? (() => {});
  // Runs started before this scheduler existed, still `running`, were left by a previous process.
  const bootedAt = clock.now();
  // Runs this scheduler's own stop() aborted: recoverable by a later start() of the same instance.
  const interrupted = new Set<string>();
  const inFlight = new Map<string, Promise<void>>();
  let shutdown = new AbortController();
  let timer: ReturnType<typeof setInterval> | undefined;
  let ticking: Promise<TaskRun[]> | undefined;

  const definitions = () => (typeof opts.tasks === "function" ? opts.tasks() : opts.tasks);

  async function maxRuns(): Promise<number> {
    const value =
      typeof opts.maxConcurrentRuns === "function"
        ? await opts.maxConcurrentRuns()
        : opts.maxConcurrentRuns;
    if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_MAX_CONCURRENT_RUNS;
    return Math.max(1, Math.floor(value));
  }

  async function policyFor(taskName: string): Promise<TaskPolicy> {
    const o = (await opts.policy?.(taskName)) ?? {};
    const d = DEFAULT_TASK_POLICY;
    return {
      // Infinity means no timeout; NaN, zero or negative fall back to the default.
      timeoutMs: typeof o.timeoutMs === "number" && o.timeoutMs > 0 ? o.timeoutMs : d.timeoutMs,
      maxRetries:
        typeof o.maxRetries === "number" && Number.isFinite(o.maxRetries) && o.maxRetries >= 0
          ? Math.floor(o.maxRetries)
          : d.maxRetries,
      overlap: o.overlap === "allow" || o.overlap === "skip" ? o.overlap : d.overlap,
    };
  }

  async function record(runId: string, update: RunUpdate): Promise<boolean> {
    return opts.store.updateStatus(
      runId,
      allowedFrom(update.status),
      toStatusWrite(update, clock.now()),
    );
  }

  async function attemptOnce(
    task: TaskDefinition,
    run: TaskRun,
    previousRef: string | undefined,
    onRef: (ref: string) => void,
    timeoutMs: number,
  ): Promise<AttemptResult> {
    const controller = new AbortController();
    const onShutdown = () => controller.abort(SHUTDOWN);
    if (shutdown.signal.aborted) return { kind: "shutdown" };
    shutdown.signal.addEventListener("abort", onShutdown, { once: true });
    const deadline = Number.isFinite(timeoutMs)
      ? setTimeout(() => controller.abort(TIMEOUT), Math.min(timeoutMs, MAX_TIMEOUT_MS))
      : undefined;

    const aborted = new Promise<AttemptResult>((resolve) =>
      controller.signal.addEventListener(
        "abort",
        () =>
          resolve(
            controller.signal.reason === TIMEOUT ? { kind: "timeout" } : { kind: "shutdown" },
          ),
        { once: true },
      ),
    );
    const executed = opts
      .execute(task, run, {
        attachRef: async (ref) => {
          onRef(ref);
          await opts.store.attachRef(run.id, ref);
        },
        signal: controller.signal,
        attempt: run.attempts,
        ...(previousRef ? { previousRef } : {}),
      })
      .then(
        (outcome): AttemptResult => ({ kind: "outcome", outcome }),
        (error): AttemptResult => ({ kind: "error", error }),
      );

    try {
      // An executor that ignores the signal is abandoned; whatever it returns later is dropped.
      return await Promise.race([executed, aborted]);
    } finally {
      clearTimeout(deadline);
      shutdown.signal.removeEventListener("abort", onShutdown);
    }
  }

  /** Attempts until an outcome, a final failure, or shutdown (which leaves the run `running`). */
  async function drive(task: TaskDefinition, first: TaskRun): Promise<void> {
    const policy = await policyFor(task.name);
    let run = first;
    let ref = first.ref;
    // A fresh claim has no ref; a recovered run continues from what it attached before.
    let previousRef = first.ref;

    for (;;) {
      const result = await attemptOnce(task, run, previousRef, (r) => (ref = r), policy.timeoutMs);

      if (result.kind === "shutdown") {
        // A restart isn't the run's fault: give the attempt back, so recovery doesn't count it.
        await opts.store.restartRun(run.id, run.startedAt, {
          startedAt: run.startedAt,
          attempts: run.attempts - 1,
        });
        interrupted.add(run.id);
        return;
      }
      if (result.kind === "timeout") {
        await record(run.id, {
          status: "failed",
          error: `Timed out after ${formatDuration(policy.timeoutMs)}.`,
        });
        return;
      }
      if (result.kind === "outcome") {
        await record(run.id, result.outcome);
        return;
      }

      report(result.error, { phase: "execute", runId: run.id });
      const retriesUsed = run.attempts - 1;
      if (retriesUsed >= policy.maxRetries || !isRetryable(result.error)) {
        const message = result.error instanceof Error ? result.error.message : String(result.error);
        await record(run.id, { status: "failed", error: message });
        return;
      }

      await sleep(retryDelayMs * run.attempts, shutdown.signal);
      if (shutdown.signal.aborted) {
        interrupted.add(run.id); // the failed attempt counts; the retry hasn't started
        return;
      }
      const startedAt = clock.now();
      const attempts = run.attempts + 1;
      if (!(await opts.store.restartRun(run.id, run.startedAt, { startedAt, attempts }))) return;
      run = { ...run, startedAt, attempts, ...(ref ? { ref } : {}) };
      previousRef = ref;
    }
  }

  function launch(task: TaskDefinition, run: TaskRun): void {
    const job = drive(task, run)
      .catch((e) => report(e, { phase: "record", runId: run.id }))
      .finally(() => inFlight.delete(run.id));
    inFlight.set(run.id, job);
  }

  async function recoverOrphans(
    byName: Map<string, TaskDefinition>,
    capacity: number,
    now: Date,
  ): Promise<TaskRun[]> {
    const recovered: TaskRun[] = [];
    for (const run of await opts.store.listRunning()) {
      if (recovered.length >= capacity) break;
      if (inFlight.has(run.id)) continue;
      const leftBehind = run.startedAt.getTime() < bootedAt.getTime() || interrupted.has(run.id);
      if (!leftBehind) continue;
      const task = byName.get(run.taskName);
      if (!task) {
        await record(run.id, { status: "failed", error: TASK_GONE_ERROR });
        continue;
      }
      // A process that dies mid-attempt never reaches drive()'s retry check, so cap it here.
      if (run.attempts - 1 >= (await policyFor(run.taskName)).maxRetries) {
        await record(run.id, { status: "failed", error: noRetriesLeftError(run.attempts) });
        continue;
      }
      const attempts = run.attempts + 1;
      if (!(await opts.store.restartRun(run.id, run.startedAt, { startedAt: now, attempts }))) {
        continue; // another process took it over first
      }
      interrupted.delete(run.id);
      const resumed = { ...run, startedAt: now, attempts };
      launch(task, resumed);
      recovered.push(resumed);
    }
    return recovered;
  }

  async function pass(): Promise<TaskRun[]> {
    const now = clock.now();
    const byName = new Map(definitions().map((t) => [t.name, t]));
    let capacity = (await maxRuns()) - inFlight.size;
    if (capacity <= 0) return [];

    const started = await recoverOrphans(byName, capacity, now);
    capacity -= started.length;

    for (const { taskName, enabledAt } of await opts.store.listEnablements()) {
      if (capacity <= 0) break; // the rest wait for the next tick; their slot is still due then
      const task = byName.get(taskName);
      if (!task) continue; // enabled, but its file is gone
      const slot = latestDueSlot(task.schedule, {
        now,
        timezone: task.timezone ?? defaultTimezone,
        notBefore: enabledAt,
      });
      if (!slot) continue;
      const policy = await policyFor(taskName);
      if (policy.overlap === "skip" && (await opts.store.hasOpenRun(taskName))) continue;
      const run = await opts.store.claimRun({
        taskName,
        slot,
        trigger: "schedule",
        startedAt: now,
      });
      if (!run) continue; // this slot already ran, here or in another process
      launch(task, run);
      started.push(run);
      capacity--;
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
      if (shutdown.signal.aborted) shutdown = new AbortController();
      const safeTick = () => {
        scheduler.tick().catch((e) => report(e, { phase: "tick" }));
      };
      safeTick();
      timer = setInterval(safeTick, intervalMs);
      timer.unref?.();
    },

    async stop(graceMs = DEFAULT_STOP_GRACE_MS) {
      if (timer) clearInterval(timer);
      timer = undefined;
      await ticking?.catch(() => {});
      if (inFlight.size > 0) {
        let grace: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          scheduler.idle(),
          new Promise<void>((resolve) => (grace = setTimeout(resolve, graceMs))),
        ]);
        clearTimeout(grace);
      }
      shutdown.abort();
      await scheduler.idle();
    },

    async runNow(taskName) {
      const task = definitions().find((t) => t.name === taskName);
      if (!task) return { ok: false, error: "unknown_task" };
      if (inFlight.size >= (await maxRuns())) return { ok: false, error: "busy" };
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
      while (inFlight.size > 0) await Promise.all([...inFlight.values()]);
    },
  };
  return scheduler;
}
