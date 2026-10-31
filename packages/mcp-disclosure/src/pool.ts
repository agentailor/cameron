import type { McpSession } from "./types";

/** An idle session is closed after this long without a call. */
export const DEFAULT_IDLE_MS = 5 * 60_000;

interface Entry {
  version: string;
  session: Promise<McpSession>;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Process-wide MCP sessions, opened on first use and shared across requests. Keyed by server id;
 * `version` is any string that changes when the server's connection settings do, so an edited
 * server is reconnected rather than reused. Concurrent first calls share one connection.
 */
export class McpConnectionPool {
  private entries = new Map<string, Entry>();

  constructor(private readonly idleMs = DEFAULT_IDLE_MS) {}

  /** The open session for a server, connecting with `open` if there is none (or it is stale). */
  async session(id: string, version: string, open: () => Promise<McpSession>): Promise<McpSession> {
    const existing = this.entries.get(id);
    if (existing && existing.version !== version) this.invalidate(id);

    let entry = this.entries.get(id);
    if (!entry) {
      const session = open().then(
        (s) => {
          s.onClose?.(() => {
            if (this.entries.get(id) === entry) this.drop(id);
          });
          return s;
        },
        (error) => {
          if (this.entries.get(id) === entry) this.drop(id);
          throw error;
        },
      );
      entry = { version, session };
      this.entries.set(id, entry);
    }
    this.touch(id, entry);
    return entry.session;
  }

  /** Closes and forgets a server's session (edited, disabled, deleted, re-authorized). */
  invalidate(id: string): void {
    const entry = this.drop(id);
    entry?.session.then((s) => s.close()).catch(() => {});
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((id) => this.invalidate(id)));
  }

  /** Ids with an open (or opening) session — for logs and tests. */
  openIds(): string[] {
    return [...this.entries.keys()].sort();
  }

  private touch(id: string, entry: Entry) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this.invalidate(id), this.idleMs);
    // Never keep the process alive just to close an idle connection.
    entry.timer.unref?.();
  }

  private drop(id: string): Entry | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    clearTimeout(entry.timer);
    this.entries.delete(id);
    return entry;
  }
}
