import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TASK_POLICY,
  TASK_GONE_ERROR,
  createScheduler,
  formatDuration,
  type SchedulerOptions,
} from "./scheduler";
import { FakeClock, MemoryTaskStore, makeTask } from "./testing";
import type { ExecutionContext, ExecutionOutcome, TaskExecutor } from "./types";

const ENABLED_AT = new Date("2026-11-01T00:00:00Z");
const NOW = "2026-11-25T12:00:00Z";

function setup(overrides: Partial<SchedulerOptions> = {}) {
  const store = new MemoryTaskStore();
  const clock = new FakeClock(new Date(NOW));
  const execute = vi.fn<TaskExecutor>(async () => ({ status: "done" }));
  const scheduler = createScheduler({
    tasks: [makeTask()],
    store,
    execute,
    clock,
    sleep: async () => {},
    ...overrides,
  });
  return { store, clock, execute, scheduler };
}

/** An executor that waits until released, and records the context it was given. */
function gate() {
  const contexts: ExecutionContext[] = [];
  const releases: ((o: ExecutionOutcome) => void)[] = [];
  const execute: TaskExecutor = (_task, _run, ctx) => {
    contexts.push(ctx);
    return new Promise((resolve) => releases.push(resolve));
  };
  const releaseAll = () => releases.splice(0).forEach((r) => r({ status: "done" }));
  return { execute, contexts, releaseAll };
}

describe("tick", () => {
  it("runs nothing for a task that isn't enabled", async () => {
    const { scheduler, execute } = setup();
    expect(await scheduler.tick()).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("runs the latest due slot of an enabled task, and records the outcome", async () => {
    const { scheduler, store, execute } = setup();
    store.enable("weekly-digest", ENABLED_AT);

    const started = await scheduler.tick();
    await scheduler.idle();

    expect(started).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(store.runs[0]).toMatchObject({
      taskName: "weekly-digest",
      slot: new Date("2026-11-23T08:00:00Z"),
      trigger: "schedule",
      status: "done",
      attempts: 1,
    });
    expect(store.runs[0].finishedAt).toBeDefined();
  });

  it("never runs the same slot twice", async () => {
    const { scheduler, store, execute } = setup();
    store.enable("weekly-digest", ENABLED_AT);
    await scheduler.tick();
    await scheduler.idle();
    await scheduler.tick();
    await scheduler.idle();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("two schedulers over one store run a slot once", async () => {
    const a = setup();
    a.store.enable("weekly-digest", ENABLED_AT);
    const b = createScheduler({
      tasks: [makeTask()],
      store: a.store,
      execute: a.execute,
      clock: a.clock,
    });
    await Promise.all([a.scheduler.tick(), b.tick()]);
    await Promise.all([a.scheduler.idle(), b.idle()]);
    expect(a.execute).toHaveBeenCalledTimes(1);
  });

  it("runs the next slot once it comes due", async () => {
    const { scheduler, store, clock, execute } = setup();
    store.enable("weekly-digest", ENABLED_AT);
    await scheduler.tick();
    await scheduler.idle();
    clock.set("2026-11-30T08:00:30Z");
    await scheduler.tick();
    await scheduler.idle();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("does not run a slot from before the task was enabled", async () => {
    const { scheduler, store, execute } = setup();
    store.enable("weekly-digest", new Date("2026-11-24T00:00:00Z"));
    await scheduler.tick();
    expect(execute).not.toHaveBeenCalled();
  });

  it("ignores an enabled task whose file is gone", async () => {
    const { scheduler, store, execute } = setup();
    store.enable("removed-task", ENABLED_AT);
    await scheduler.tick();
    expect(execute).not.toHaveBeenCalled();
  });

  it("uses the default zone for a task that names none", async () => {
    const { scheduler, store } = setup({ defaultTimezone: "Europe/Paris" });
    store.enable("weekly-digest", ENABLED_AT);
    await scheduler.tick();
    await scheduler.idle();
    expect(store.runs[0].slot.toISOString()).toBe("2026-11-23T07:00:00.000Z");
  });
});

describe("overlap", () => {
  it("skips a due slot while the task has a run paused", async () => {
    const { scheduler, store, execute } = setup();
    store.enable("weekly-digest", ENABLED_AT);
    store.seed({
      taskName: "weekly-digest",
      startedAt: new Date("2026-11-16T08:00:00Z"),
      status: "paused",
    });
    expect(await scheduler.tick()).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("runs it anyway when the task's policy allows overlap", async () => {
    const { scheduler, store, execute } = setup({ policy: () => ({ overlap: "allow" }) });
    store.enable("weekly-digest", ENABLED_AT);
    store.seed({
      taskName: "weekly-digest",
      startedAt: new Date("2026-11-16T08:00:00Z"),
      status: "paused",
    });
    await scheduler.tick();
    await scheduler.idle();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("concurrency", () => {
  const twoTasks = [makeTask(), makeTask({ name: "monthly-review" })];

  it("starts no more than the limit; the rest start on a later tick", async () => {
    const g = gate();
    const { scheduler, store } = setup({
      tasks: twoTasks,
      execute: g.execute,
      maxConcurrentRuns: 1,
    });
    store.enable("weekly-digest", ENABLED_AT);
    store.enable("monthly-review", ENABLED_AT);

    expect(await scheduler.tick()).toHaveLength(1);
    expect(await scheduler.tick()).toEqual([]);
    g.releaseAll();
    await scheduler.idle();
    expect(await scheduler.tick()).toHaveLength(1);
    g.releaseAll();
    await scheduler.idle();
    expect(store.runs.map((r) => r.status)).toEqual(["done", "done"]);
  });

  it("reads the limit on every tick", async () => {
    let limit = 1;
    const g = gate();
    const { scheduler, store } = setup({
      tasks: twoTasks,
      execute: g.execute,
      maxConcurrentRuns: () => limit,
    });
    store.enable("weekly-digest", ENABLED_AT);
    store.enable("monthly-review", ENABLED_AT);
    await scheduler.tick();
    limit = 2;
    expect(await scheduler.tick()).toHaveLength(1);
    g.releaseAll();
    await scheduler.idle();
  });

  it("runNow is busy at the limit", async () => {
    const g = gate();
    const { scheduler } = setup({ execute: g.execute, maxConcurrentRuns: 1 });
    expect((await scheduler.runNow("weekly-digest")).ok).toBe(true);
    expect(await scheduler.runNow("weekly-digest")).toEqual({ ok: false, error: "busy" });
    g.releaseAll();
    await scheduler.idle();
  });
});

describe("timeout", () => {
  it("aborts the attempt and fails the run", async () => {
    const g = gate();
    const { scheduler, store } = setup({ execute: g.execute, policy: () => ({ timeoutMs: 20 }) });
    await scheduler.runNow("weekly-digest");
    await scheduler.idle();
    expect(g.contexts[0].signal.aborted).toBe(true);
    expect(store.runs[0]).toMatchObject({ status: "failed", error: "Timed out after 20 ms." });
  });

  it("drops what an executor that ignored the signal returns later", async () => {
    const g = gate();
    const { scheduler, store } = setup({ execute: g.execute, policy: () => ({ timeoutMs: 20 }) });
    await scheduler.runNow("weekly-digest");
    await scheduler.idle();
    g.releaseAll();
    await new Promise((r) => setTimeout(r, 5));
    expect(store.runs[0].status).toBe("failed");
  });

  it("is never retried", async () => {
    const g = gate();
    const { scheduler, store } = setup({
      execute: g.execute,
      policy: () => ({ timeoutMs: 20, maxRetries: 3 }),
    });
    await scheduler.runNow("weekly-digest");
    await scheduler.idle();
    expect(g.contexts).toHaveLength(1);
    expect(store.runs[0].attempts).toBe(1);
  });
});

describe("retries", () => {
  it("retries a thrown error, passing the earlier attempt's ref", async () => {
    const contexts: ExecutionContext[] = [];
    const { scheduler, store } = setup({
      execute: async (_task, _run, ctx) => {
        contexts.push(ctx);
        if (ctx.attempt === 1) {
          await ctx.attachRef("thread-1");
          throw new Error("429 rate limited");
        }
        return { status: "done" };
      },
    });
    await scheduler.runNow("weekly-digest");
    await scheduler.idle();
    expect(contexts.map((c) => [c.attempt, c.previousRef])).toEqual([
      [1, undefined],
      [2, "thread-1"],
    ]);
    expect(store.runs[0]).toMatchObject({ status: "done", attempts: 2, ref: "thread-1" });
  });

  it("waits longer before each retry", async () => {
    const sleep = vi.fn(async (_ms: number, _signal: AbortSignal) => {});
    const { scheduler } = setup({
      sleep,
      retryDelayMs: 1000,
      policy: () => ({ maxRetries: 2 }),
      execute: async () => {
        throw new Error("flaky");
      },
    });
    await scheduler.runNow("weekly-digest");
    await scheduler.idle();
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
  });

  it("fails once the retries are used up", async () => {
    const execute = vi.fn<TaskExecutor>(async () => {
      throw new Error("still down");
    });
    const { scheduler, store } = setup({ execute });
    await scheduler.runNow("weekly-digest");
    await scheduler.idle();
    expect(execute).toHaveBeenCalledTimes(1 + DEFAULT_TASK_POLICY.maxRetries);
    expect(store.runs[0]).toMatchObject({ status: "failed", error: "still down", attempts: 2 });
  });

  it("does not retry an error the app says isn't retryable", async () => {
    const execute = vi.fn<TaskExecutor>(async () => {
      throw new Error("ran out of steps");
    });
    const { scheduler, store } = setup({ execute, isRetryable: () => false });
    await scheduler.runNow("weekly-digest");
    await scheduler.idle();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(store.runs[0].status).toBe("failed");
  });

  it("does not retry with maxRetries 0", async () => {
    const execute = vi.fn<TaskExecutor>(async () => {
      throw new Error("boom");
    });
    const { scheduler } = setup({ execute, policy: () => ({ maxRetries: 0 }) });
    await scheduler.runNow("weekly-digest");
    await scheduler.idle();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("an undefined override keeps the default", async () => {
    const execute = vi.fn<TaskExecutor>(async () => {
      throw new Error("boom");
    });
    const { scheduler } = setup({ execute, policy: () => ({ maxRetries: undefined }) });
    await scheduler.runNow("weekly-digest");
    await scheduler.idle();
    expect(execute).toHaveBeenCalledTimes(1 + DEFAULT_TASK_POLICY.maxRetries);
  });
});

describe("recovery after a restart", () => {
  it("continues a run a previous process left running, from its ref", async () => {
    const contexts: ExecutionContext[] = [];
    const { scheduler, store } = setup({
      execute: async (_task, _run, ctx) => {
        contexts.push(ctx);
        return { status: "done" };
      },
    });
    store.seed({
      taskName: "weekly-digest",
      startedAt: new Date("2026-11-25T11:58:00Z"),
      ref: "thread-9",
    });

    const started = await scheduler.tick();
    await scheduler.idle();

    expect(started).toHaveLength(1);
    expect(contexts[0]).toMatchObject({ attempt: 2, previousRef: "thread-9" });
    expect(store.runs[0]).toMatchObject({ status: "done", attempts: 2 });
  });

  it("fails a left-over run whose task file is gone", async () => {
    const { scheduler, store, execute } = setup();
    store.seed({ taskName: "removed-task", startedAt: new Date("2026-11-25T11:58:00Z") });
    await scheduler.tick();
    expect(execute).not.toHaveBeenCalled();
    expect(store.runs[0]).toMatchObject({ status: "failed", error: TASK_GONE_ERROR });
  });

  it("recovers within the concurrency limit", async () => {
    const g = gate();
    const { scheduler, store } = setup({ execute: g.execute, maxConcurrentRuns: 1 });
    store.seed({ taskName: "weekly-digest", startedAt: new Date("2026-11-25T11:58:00Z") });
    store.seed({ taskName: "weekly-digest", startedAt: new Date("2026-11-25T11:59:00Z") });
    expect(await scheduler.tick()).toHaveLength(1);
    g.releaseAll();
    await scheduler.idle();
    expect(await scheduler.tick()).toHaveLength(1);
    g.releaseAll();
    await scheduler.idle();
    expect(store.runs.every((r) => r.status === "done")).toBe(true);
  });

  it("two schedulers can't both take over the same run", async () => {
    const a = setup();
    a.store.seed({ taskName: "weekly-digest", startedAt: new Date("2026-11-25T11:58:00Z") });
    const b = createScheduler({
      tasks: [makeTask()],
      store: a.store,
      execute: a.execute,
      clock: a.clock,
    });
    await Promise.all([a.scheduler.tick(), b.tick()]);
    await Promise.all([a.scheduler.idle(), b.idle()]);
    expect(a.execute).toHaveBeenCalledTimes(1);
  });
});

describe("stop", () => {
  it("lets a run that finishes within the grace period finish", async () => {
    const { scheduler, store } = setup();
    await scheduler.runNow("weekly-digest");
    await scheduler.stop(1000);
    expect(store.runs[0].status).toBe("done");
  });

  it("aborts what is still going after the grace period, and leaves it running", async () => {
    const g = gate();
    const { scheduler, store } = setup({ execute: g.execute });
    await scheduler.runNow("weekly-digest");
    await scheduler.stop(10);
    expect(g.contexts[0].signal.aborted).toBe(true);
    expect(store.runs[0].status).toBe("running");
  });
});

describe("execution", () => {
  it("records a pause with its reason", async () => {
    const { scheduler, store } = setup({
      execute: async () => ({ status: "paused", reason: "approval" }),
    });
    await scheduler.runNow("weekly-digest");
    await scheduler.idle();
    expect(store.runs[0]).toMatchObject({ status: "paused", pauseReason: "approval" });
  });

  it("refuses an unknown task", async () => {
    const { scheduler } = setup();
    expect(await scheduler.runNow("nope")).toEqual({ ok: false, error: "unknown_task" });
  });
});

describe("update", () => {
  it("resumes a paused run and settles it", async () => {
    const { scheduler, store } = setup({
      execute: async () => ({ status: "paused", reason: "approval" }),
    });
    await scheduler.runNow("weekly-digest");
    await scheduler.idle();
    expect(await scheduler.update("run-1", { status: "running" })).toBe(true);
    expect(await scheduler.update("run-1", { status: "done" })).toBe(true);
    expect(store.runs[0].status).toBe("done");
  });

  it("refuses to move a finished run", async () => {
    const { scheduler } = setup();
    await scheduler.runNow("weekly-digest");
    await scheduler.idle();
    expect(await scheduler.update("run-1", { status: "running" })).toBe(false);
  });
});

describe("formatDuration", () => {
  it("uses the largest whole unit", () => {
    expect(formatDuration(600_000)).toBe("10 min");
    expect(formatDuration(30_000)).toBe("30 s");
    expect(formatDuration(20)).toBe("20 ms");
  });
});
