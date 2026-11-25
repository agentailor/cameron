import { describe, expect, it } from "vitest";
import { allowedFrom, canTransition, isTerminal, toStatusWrite } from "./lifecycle";

describe("lifecycle", () => {
  it("done and failed are terminal", () => {
    expect(isTerminal("done")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(canTransition("done", "running")).toBe(false);
    expect(canTransition("failed", "done")).toBe(false);
  });

  it("a paused run can be resumed or settled", () => {
    for (const to of ["running", "done", "failed"] as const) {
      expect(canTransition("paused", to)).toBe(true);
    }
  });

  it("only a paused run can go back to running", () => {
    expect(allowedFrom("running")).toEqual(["paused"]);
  });

  it("clears fields that don't belong to the new status", () => {
    const now = new Date("2026-11-25T00:00:00Z");
    expect(toStatusWrite({ status: "running" }, now)).toEqual({
      status: "running",
      pauseReason: undefined,
      error: undefined,
      finishedAt: undefined,
    });
    expect(toStatusWrite({ status: "failed", error: "boom" }, now)).toMatchObject({
      status: "failed",
      error: "boom",
      pauseReason: undefined,
      finishedAt: now,
    });
  });
});
