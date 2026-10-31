import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpConnectionPool } from "./pool";
import type { McpSession } from "./types";

function fakeSession() {
  let onClose: (() => void) | undefined;
  const session: McpSession & { closed: boolean; drop: () => void } = {
    closed: false,
    manifest: async () => ({ tools: [] }),
    getTool: () => undefined,
    close: async () => {
      session.closed = true;
    },
    onClose: (listener) => {
      onClose = listener;
    },
    drop: () => onClose?.(),
  };
  return session;
}

describe("McpConnectionPool", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shares one connection between concurrent first calls and later calls", async () => {
    const pool = new McpConnectionPool(1000);
    const open = vi.fn(async () => fakeSession());
    const [a, b] = await Promise.all([
      pool.session("s", "v1", open),
      pool.session("s", "v1", open),
    ]);
    const c = await pool.session("s", "v1", open);
    expect(open).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(c).toBe(a);
  });

  it("reconnects when the version changes, closing the old session", async () => {
    const pool = new McpConnectionPool(1000);
    const first = await pool.session("s", "v1", async () => fakeSession());
    const second = await pool.session("s", "v2", async () => fakeSession());
    await vi.runAllTimersAsync();
    expect(second).not.toBe(first);
    expect((first as ReturnType<typeof fakeSession>).closed).toBe(true);
  });

  it("closes a session idle for idleMs, and each use restarts the clock", async () => {
    const pool = new McpConnectionPool(1000);
    const session = (await pool.session("s", "v1", async () => fakeSession())) as ReturnType<
      typeof fakeSession
    >;
    await vi.advanceTimersByTimeAsync(800);
    await pool.session("s", "v1", async () => fakeSession());
    await vi.advanceTimersByTimeAsync(800);
    expect(session.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(session.closed).toBe(true);
    expect(pool.openIds()).toEqual([]);
  });

  it("forgets a failed connection so the next call retries", async () => {
    const pool = new McpConnectionPool(1000);
    await expect(
      pool.session("s", "v1", async () => {
        throw new Error("ENOENT");
      }),
    ).rejects.toThrow("ENOENT");
    expect(pool.openIds()).toEqual([]);
    await expect(pool.session("s", "v1", async () => fakeSession())).resolves.toBeDefined();
  });

  it("forgets a session that closes on its own", async () => {
    const pool = new McpConnectionPool(1000);
    const session = (await pool.session("s", "v1", async () => fakeSession())) as ReturnType<
      typeof fakeSession
    >;
    session.drop();
    expect(pool.openIds()).toEqual([]);
  });

  it("invalidate closes and forgets", async () => {
    const pool = new McpConnectionPool(1000);
    const session = (await pool.session("s", "v1", async () => fakeSession())) as ReturnType<
      typeof fakeSession
    >;
    pool.invalidate("s");
    await vi.runAllTimersAsync();
    expect(session.closed).toBe(true);
    expect(pool.openIds()).toEqual([]);
  });
});
