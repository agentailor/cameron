import { describe, expect, it } from "vitest";
import { AGENT_RECURSION_LIMIT } from "@/lib/agent/recursion";
import { PermanentTaskError, isRetryableTaskError, toTaskError } from "./errors";

function named(name: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(name), { name }, extra);
}

describe("isRetryableTaskError", () => {
  it("retries what may pass: a rate limit, a server error, a dropped connection", () => {
    expect(isRetryableTaskError(Object.assign(new Error("429"), { status: 429 }))).toBe(true);
    expect(isRetryableTaskError(Object.assign(new Error("502"), { status: 502 }))).toBe(true);
    expect(isRetryableTaskError(new Error("ECONNRESET"))).toBe(true);
  });

  it("doesn't retry what would fail the same way", () => {
    expect(isRetryableTaskError(new PermanentTaskError("no"))).toBe(false);
    expect(isRetryableTaskError(named("ModelNotConfiguredError"))).toBe(false);
    expect(isRetryableTaskError(named("AbortError"))).toBe(false);
    expect(isRetryableTaskError(Object.assign(new Error("bad key"), { status: 401 }))).toBe(false);
    expect(
      isRetryableTaskError(Object.assign(new Error("bad"), { response: { status: 400 } })),
    ).toBe(false);
  });
});

describe("toTaskError", () => {
  it("turns running out of steps into a readable, permanent failure", () => {
    const error = toTaskError(named("GraphRecursionError"));
    expect(error).toBeInstanceOf(PermanentTaskError);
    expect((error as Error).message).toBe(`Ran out of steps (limit ${AGENT_RECURSION_LIMIT}).`);
    expect(isRetryableTaskError(error)).toBe(false);
  });

  it("passes other errors through", () => {
    const error = new Error("boom");
    expect(toTaskError(error)).toBe(error);
  });
});
