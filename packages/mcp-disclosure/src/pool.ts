import type { McpSession } from "./types";

/** An idle session is closed after this long without a call. */
export const DEFAULT_IDLE_MS = 5 * 60_000;

interface Entry {
  version: string;
  session: Promise<McpSession>;
  timer?: ReturnType<typeof setTimeout>;
  /** Calls running on this session; the idle clock only runs at zero. */
  busy: number;
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
    const entry = this.entry(id, version, open);
    this.touch(id, entry);
    return entry.session;
  }

  /**
   * Like {@link session}, but holds the session open until `release` is called, so a call longer
   * than the idle timeout is not closed under itself.
   */
  async acquire(
    id: string,
    version: string,
    open: () => Promise<McpSession>,
  ): Promise<{ session: McpSession; release: () => void }> {
    const entry = this.entry(id, version, open);
    entry.busy++;
    clearTimeout(entry.timer);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      entry.busy--;
      if (entry.busy === 0 && this.entries.get(id) === entry) this.touch(id, entry);
    };
    try {
      return { session: await entry.session, release };
    } catch (error) {
      release();
      throw error;
    }
  }

  /** Closes and forgets a server's session (edited, disabled, deleted, re-authorized). */
  invalidate(id: string): void {
    void this.close(this.drop(id));
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((id) => this.close(this.drop(id))));
  }

  /** Ids with an open (or opening) session — for logs and tests. */
  openIds(): string[] {
    return [...this.entries.keys()].sort();
  }

  private entry(id: string, version: string, open: () => Promise<McpSession>): Entry {
    const existing = this.entries.get(id);
    if (existing && existing.version !== version) this.invalidate(id);

    let entry = this.entries.get(id);
    if (!entry) {
      const created: Entry = {
        version,
        busy: 0,
        session: open().then(
          (s) => {
            s.onClose?.(() => {
              if (this.entries.get(id) === created) this.drop(id);
            });
            return s;
          },
          (error) => {
            if (this.entries.get(id) === created) this.drop(id);
            throw error;
          },
        ),
      };
      entry = created;
      this.entries.set(id, entry);
    }
    return entry;
  }

  private async close(entry: Entry | undefined): Promise<void> {
    await entry?.session.then((s) => s.close()).catch(() => {});
  }

  private touch(id: string, entry: Entry) {
    clearTimeout(entry.timer);
    if (entry.busy > 0) return;
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
