import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_CONCURRENT_RUNS, DEFAULT_TASK_POLICY } from "@agentailor/agent-tasks";
import { LIMIT_DEFAULTS, effectiveLimit, parseLimit, toPolicy } from "./limits";

describe("LIMIT_DEFAULTS", () => {
  it("are the package's defaults, so the page shows what actually applies", () => {
    expect(LIMIT_DEFAULTS).toEqual({
      maxConcurrentRuns: DEFAULT_MAX_CONCURRENT_RUNS,
      timeoutMinutes: DEFAULT_TASK_POLICY.timeoutMs / 60_000,
      maxRetries: DEFAULT_TASK_POLICY.maxRetries,
    });
  });
});

describe("parseLimit", () => {
  it("clears on null or empty", () => {
    expect(parseLimit("timeoutMinutes", null)).toEqual({ ok: true, value: null });
    expect(parseLimit("timeoutMinutes", "")).toEqual({ ok: true, value: null });
  });

  it("accepts a whole number in bounds, from a number or a string", () => {
    expect(parseLimit("maxRetries", 0)).toEqual({ ok: true, value: 0 });
    expect(parseLimit("maxConcurrentRuns", "4")).toEqual({ ok: true, value: 4 });
  });

  it.each([
    ["maxConcurrentRuns", 0],
    ["maxConcurrentRuns", 11],
    ["timeoutMinutes", 1.5],
    ["timeoutMinutes", 1441],
    ["maxRetries", -1],
    ["maxRetries", "two"],
    ["maxRetries", true],
  ] as const)("rejects %s = %s with a readable message", (field, value) => {
    const result = parseLimit(field, value);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/must be a whole number from/);
    expect(!result.ok && result.error).not.toMatch(/maxRetries|timeoutMinutes|maxConcurrentRuns/);
  });
});

describe("effectiveLimit and toPolicy", () => {
  it("prefers the task's value, then the global one, then the default", () => {
    expect(effectiveLimit("maxRetries", { maxRetries: 3 }, { maxRetries: 2 })).toBe(3);
    expect(effectiveLimit("maxRetries", {}, { maxRetries: 2 })).toBe(2);
    expect(effectiveLimit("maxRetries", undefined, {})).toBe(LIMIT_DEFAULTS.maxRetries);
  });

  it("converts minutes to the package's milliseconds", () => {
    expect(toPolicy({ timeoutMinutes: 5 }, { maxRetries: 0 })).toEqual({
      timeoutMs: 300_000,
      maxRetries: 0,
    });
  });

  it("a task's 0 retries is a value, not a missing one", () => {
    expect(toPolicy({ maxRetries: 0 }, { maxRetries: 4 }).maxRetries).toBe(0);
  });
});
