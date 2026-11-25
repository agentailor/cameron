import { describe, expect, it } from "vitest";
import { makeTask } from "@agentailor/agent-tasks/testing";
import { toRunView, toTaskView } from "./view";

const NOW = new Date("2026-11-25T12:00:00Z");

describe("toTaskView", () => {
  it("is off, with no next run, when the owner never enabled it", () => {
    expect(toTaskView(makeTask(), undefined, "UTC", NOW)).toMatchObject({
      enabled: false,
      nextRunAt: null,
      timezone: "UTC",
    });
  });

  it("shows the next slot in the task's own zone when enabled", () => {
    const view = toTaskView(
      makeTask({ timezone: "Europe/Paris" }),
      { taskName: "weekly-digest", enabled: true, enabledAt: NOW },
      "UTC",
      NOW,
    );
    expect(view).toMatchObject({
      enabled: true,
      timezone: "Europe/Paris",
      nextRunAt: "2026-11-30T07:00:00.000Z",
    });
  });
});

describe("toRunView", () => {
  it("exposes the run's ref as its thread, and absent fields as null", () => {
    const view = toRunView({
      id: "r1",
      taskName: "weekly-digest",
      slot: NOW,
      trigger: "manual",
      status: "paused",
      pauseReason: "approval",
      ref: "thread-1",
      startedAt: NOW,
    });
    expect(view).toMatchObject({ threadId: "thread-1", error: null, finishedAt: null });
  });
});
