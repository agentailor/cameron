import { describe, expect, it } from "vitest";
import { columnTimestampToIso, columnToDate, toColumnTimestamp } from "./timestamps";

/** The columns return naive literals that are already UTC; reading them as local shifts them. */
describe("timestamp columns", () => {
  it("reads a naive column literal as UTC, whatever the local timezone", () => {
    expect(columnToDate("2026-01-07 12:00:00").toISOString()).toBe("2026-01-07T12:00:00.000Z");
    expect(columnTimestampToIso("2026-09-05 10:20:18.013")).toBe("2026-09-05T10:20:18.013Z");
  });

  it("round-trips through the column format", () => {
    const iso = "2026-10-10T14:06:54.779Z";
    expect(columnTimestampToIso(toColumnTimestamp(iso)!)).toBe(iso);
  });

  it("rejects an unparseable value instead of writing it", () => {
    expect(toColumnTimestamp("not a date")).toBeNull();
  });
});
