import { describe, expect, it, vi } from "vitest";
import { STALE_RUN_ERROR, createScheduler, type SchedulerOptions } from "./scheduler";
import { FakeClock, MemoryTaskStore, makeTask } from "./testing";
import type { TaskExecutor } from "./types";

const ENABLED_AT = new Date("2026-11-01T00:00:00Z");

function setup(overrides: Partial<SchedulerOptions> = {}) {
  const store = new MemoryTaskStore();
  const clock = new FakeClock(new Date("2026-11-25T12:00:00Z"));
  const execute = vi.fn<TaskExecutor>(async () => ({ status: "done" }));
  const scheduler = createScheduler({ tasks: [makeTask()], store, execute, clock, ...overrides });
  return { store, clock, execute, scheduler };
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
    });
    expect(store.runs[0].finishedAt).toBeDefined();
  });

  it("never runs the same slot twice", async () => {
    const { scheduler, store, execute } = setup();
    store.enable("weekly-digest", ENABLED_AT);
    await scheduler.tick();
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
    clock.set("2026-11-30T08:00:30Z");
    await scheduler.tick();
    await scheduler.idle();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(store.runs.map((r) => r.slot.toISOString())).toEqual([
      "2026-11-23T08:00:00.000Z",
      "2026-11-30T08:00:00.000Z",
    ]);
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

  it("reads tasks from a function on each tick", async () => {
    let tasks = [makeTask()];
    const { scheduler, store, execute } = setup({ tasks: () => tasks });
    store.enable("other", ENABLED_AT);
    await scheduler.tick();
    tasks = [makeTask(), makeTask({ name: "other" })];
    await scheduler.tick();
    await scheduler.idle();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("uses the default zone for a task that names none", async () => {
    const { scheduler, store } = setup({ defaultTimezone: "Europe/Paris" });
    store.enable("weekly-digest", ENABLED_AT);
    await scheduler.tick();
    expect(store.runs[0].slot.toISOString()).toBe("2026-11-23T07:00:00.000Z");
  });

  it("fails a run left running past the timeout", async () => {
    const { scheduler, store } = setup({ runTimeoutMs: 60_000 });
    store.runs.push({
      id: "orphan",
      taskName: "weekly-digest",
      slot: new Date("2026-11-16T08:00:00Z"),
      trigger: "schedule",
      status: "running",
      startedAt: new Date("2026-11-16T08:00:00Z"),
    });
    await scheduler.tick();
    expect(store.runs[0]).toMatchObject({ status: "failed", error: STALE_RUN_ERROR });
  });
});

describe("execution", () => {
  it("records a pause with its reason", async () => {
    const { scheduler, store } = setup({
      execute: async () => ({ status: "paused", reason: "approval" }),
    });
    store.enable("weekly-digest", ENABLED_AT);
    await scheduler.tick();
    await scheduler.idle();
    expect(store.runs[0]).toMatchObject({ status: "paused", pauseReason: "approval" });
    expect(store.runs[0].finishedAt).toBeUndefined();
  });

  it("a throwing executor fails the run and keeps the ref it attached", async () => {
    const onError = vi.fn();
    const { scheduler, store } = setup({
      onError,
      execute: async (_task, _run, ctx) => {
        await ctx.attachRef("thread-1");
        throw new Error("model unreachable");
      },
    });
    store.enable("weekly-digest", ENABLED_AT);
    await scheduler.tick();
    await scheduler.idle();
    expect(store.runs[0]).toMatchObject({
      status: "failed",
      error: "model unreachable",
      ref: "thread-1",
    });
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { phase: "execute", runId: "run-1" });
  });

  it("tick returns before the run finishes", async () => {
    let release!: () => void;
    const { scheduler, store } = setup({
      execute: () =>
        new Promise((resolve) => {
          release = () => resolve({ status: "done" });
        }),
    });
    store.enable("weekly-digest", ENABLED_AT);
    await scheduler.tick();
    expect(store.runs[0].status).toBe("running");
    release();
    await scheduler.idle();
    expect(store.runs[0].status).toBe("done");
  });
});

describe("runNow", () => {
  it("runs a task that isn't enabled, as a manual run", async () => {
    const { scheduler, store, execute } = setup();
    const result = await scheduler.runNow("weekly-digest");
    await scheduler.idle();
    expect(result.ok).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(store.runs[0]).toMatchObject({ trigger: "manual", status: "done" });
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
    store.enable("weekly-digest", ENABLED_AT);
    await scheduler.tick();
    await scheduler.idle();

    expect(await scheduler.update("run-1", { status: "running" })).toBe(true);
    expect(store.runs[0]).toMatchObject({ status: "running", pauseReason: undefined });
    expect(await scheduler.update("run-1", { status: "done" })).toBe(true);
    expect(store.runs[0].status).toBe("done");
  });

  it("refuses to move a finished run", async () => {
    const { scheduler, store } = setup();
    store.enable("weekly-digest", ENABLED_AT);
    await scheduler.tick();
    await scheduler.idle();
    expect(await scheduler.update("run-1", { status: "running" })).toBe(false);
    expect(store.runs[0].status).toBe("done");
  });
});

describe("start / stop", () => {
  it("ticks on start and waits for in-flight runs on stop", async () => {
    const { scheduler, store, execute } = setup({ intervalMs: 10_000 });
    store.enable("weekly-digest", ENABLED_AT);
    scheduler.start();
    await scheduler.stop();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(store.runs[0].status).toBe("done");
  });
});
