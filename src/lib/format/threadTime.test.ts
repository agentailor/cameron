import { describe, expect, it } from "vitest";
import { formatThreadTime } from "./threadTime";

// A fixed "now" so the relative cases are deterministic.
const NOW = new Date("2026-09-05T14:00:00.000Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

describe("formatThreadTime", () => {
  it("collapses the last minute to 'just now'", () => {
    expect(formatThreadTime(minutesAgo(0), NOW)).toBe("just now");
  });

  it("uses relative time within the last hour", () => {
    expect(formatThreadTime(minutesAgo(5), NOW)).toBe("5 minutes ago");
    expect(formatThreadTime(minutesAgo(59), NOW)).toBe("59 minutes ago");
  });

  it("switches to a clock time later in the day", () => {
    // Relative time is minute-granular, so threads started seconds apart collapse to one label.
    // The clock time is what keeps them distinguishable.
    expect(formatThreadTime(minutesAgo(120), NOW)).not.toMatch(/ago/);
    expect(formatThreadTime(minutesAgo(120), NOW)).toMatch(/\d/);
  });

  it("labels yesterday explicitly rather than as '1 day ago'", () => {
    const yesterday = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    expect(formatThreadTime(yesterday, NOW)).toMatch(/^yesterday /);
  });

  it("distinguishes threads created minutes apart on the same day", () => {
    // The defect this replaces: a bare date rendered these identically.
    const a = formatThreadTime(minutesAgo(5), NOW);
    const b = formatThreadTime(minutesAgo(45), NOW);
    expect(a).not.toBe(b);
  });

  it("falls back to a calendar date for older threads", () => {
    const older = new Date("2026-03-02T09:00:00.000Z");
    const label = formatThreadTime(older, NOW);
    expect(label).not.toMatch(/ago|yesterday|just now/);
    expect(label).toMatch(/Mar/);
  });

  it("includes the year once the thread is from a previous year", () => {
    expect(formatThreadTime(new Date("2024-03-02T09:00:00.000Z"), NOW)).toMatch(/2024/);
  });

  it("returns an empty string for an unparseable value rather than 'Invalid Date'", () => {
    expect(formatThreadTime("not a date", NOW)).toBe("");
  });
});
