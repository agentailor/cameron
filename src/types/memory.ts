/**
 * Domain type for a remembered preference, returned by `memoryRepository` so callers never depend
 * on Drizzle row types.
 */
export interface Memory {
  id: string;
  /** What the agent sees in its prompt: names when the memory applies. Unique, ignoring case. */
  title: string;
  content: string;
  /** The thread it was saved in; may no longer exist. */
  sourceThreadId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMemoryInput {
  title: string;
  content: string;
  sourceThreadId?: string | null;
}

/** A duplicate title is an expected outcome, not an error: the caller replaces `existing`. */
export type CreateMemoryResult =
  | { ok: true; memory: Memory }
  | { ok: false; reason: "duplicate_title"; existing: Memory };

export type UpdateMemoryResult =
  | { ok: true; memory: Memory }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "duplicate_title"; existing: Memory };
