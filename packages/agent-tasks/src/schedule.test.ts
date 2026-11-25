import { describe, expect, it } from "vitest";
import { latestDueSlot, nextSlot, validateSchedule } from "./schedule";

const MONDAY_8 = "0 8 * * MON";

describe("validateSchedule", () => {
  it("accepts a five-field expression", () => {
    expect(validateSchedule(MONDAY_8)).toEqual({ ok: true });
  });

  it("rejects a seconds field: ticks are a minute apart", () => {
    const result = validateSchedule("*/5 * * * * *");
    expect(result.ok).toBe(false);
  });

  it("rejects nonsense and an unknown zone", () => {
    expect(validateSchedule("0 8 * * NOPE").ok).toBe(false);
    expect(validateSchedule(MONDAY_8, "Mars/Base").ok).toBe(false);
  });
});

describe("latestDueSlot", () => {
  const tz = "UTC";

  it("returns the most recent occurrence", () => {
    const slot = latestDueSlot(MONDAY_8, { now: new Date("2026-11-25T12:00:00Z"), timezone: tz });
    expect(slot?.toISOString()).toBe("2026-11-23T08:00:00.000Z");
  });

  it("counts a slot exactly at now", () => {
    const slot = latestDueSlot(MONDAY_8, { now: new Date("2026-11-23T08:00:00Z"), timezone: tz });
    expect(slot?.toISOString()).toBe("2026-11-23T08:00:00.000Z");
  });

  it("returns only the latest slot after a long outage, so it catches up once", () => {
    const slot = latestDueSlot(MONDAY_8, { now: new Date("2026-12-20T00:00:00Z"), timezone: tz });
    expect(slot?.toISOString()).toBe("2026-12-14T08:00:00.000Z");
  });

  it("returns null for a slot before notBefore (enabled after it)", () => {
    const slot = latestDueSlot(MONDAY_8, {
      now: new Date("2026-11-25T12:00:00Z"),
      timezone: tz,
      notBefore: new Date("2026-11-24T00:00:00Z"),
    });
    expect(slot).toBeNull();
  });

  it("reads the schedule in the task's zone", () => {
    const slot = latestDueSlot(MONDAY_8, {
      now: new Date("2026-11-25T12:00:00Z"),
      timezone: "Europe/Paris",
    });
    expect(slot?.toISOString()).toBe("2026-11-23T07:00:00.000Z");
  });

  it("follows daylight saving: 8:00 Paris is 06:00 UTC in summer", () => {
    const slot = latestDueSlot(MONDAY_8, {
      now: new Date("2026-07-08T12:00:00Z"),
      timezone: "Europe/Paris",
    });
    expect(slot?.toISOString()).toBe("2026-07-06T06:00:00.000Z");
  });
});

describe("nextSlot", () => {
  it("is strictly after now", () => {
    const next = nextSlot(MONDAY_8, { now: new Date("2026-11-23T08:00:00Z"), timezone: "UTC" });
    expect(next.toISOString()).toBe("2026-11-30T08:00:00.000Z");
  });
});
