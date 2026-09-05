import { and, count, desc, eq, lt, or } from "drizzle-orm";
import db from "@/lib/database/db";
import { threads } from "@/lib/database/schema";
import type { ThreadRecord } from "@/types/mcp";

/**
 * Persistence for Thread metadata. This is the ONLY seam between the app and the ORM
 * for threads — callers use these functions and receive plain domain objects
 * ({@link ThreadRecord}), never Drizzle row types. Swapping the ORM means rewriting
 * this file alone.
 *
 * Notes carried over from the previous Prisma layer:
 * - ids are generated in the app (the column has no DB default).
 * - `updatedAt` is app-managed (no DB default / trigger), so writes set it explicitly.
 */

type ThreadRow = typeof threads.$inferSelect;

function toDomain(row: ThreadRow): ThreadRecord {
  return {
    id: row.id,
    title: row.title,
    // Parsed as UTC, not local — see columnTimestampToIso.
    createdAt: new Date(columnTimestampToIso(row.createdAt)),
    updatedAt: new Date(columnTimestampToIso(row.updatedAt)),
  };
}

function now(): string {
  return new Date().toISOString();
}

/**
 * The `mode: "string"` timestamp columns hand back a naive literal ("2026-09-05 10:20:18.013")
 * that is ALREADY UTC; `new Date(...)` would read it as local and shift it by the offset. These
 * two helpers pin the interpretation to UTC in both directions. Getting it wrong is silent — the
 * cursor still validates and still queries, it just matches nothing and ends the list early.
 */
function columnTimestampToIso(value: string): string {
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

/** ISO string -> the literal format the timestamp columns compare against (UTC, no zone suffix). */
function toColumnTimestamp(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace("T", " ").replace("Z", "");
}

/** Opaque position in the thread list, encoding the sort key of the last row returned. */
export interface ThreadCursor {
  updatedAt: string;
  id: string;
}

export interface ThreadPage {
  rows: ThreadRecord[];
  /**
   * Total threads, ignoring the limit, so a capped page is visibly partial. Counted only when the
   * page came back full; otherwise it IS `rows.length`.
   */
  total: number;
  /** Position to pass back for the next page; null when this page is the last one. */
  nextCursor: ThreadCursor | null;
}

/**
 * One page of threads, most recently updated first.
 *
 * Cursor rather than offset: the sort key `updatedAt` moves while paging — sending a message in
 * an older thread reorders the list — so an offset would skip or repeat rows. The `id` tiebreak
 * keeps the order total when timestamps collide.
 */
export async function list(
  options: { limit?: number; cursor?: ThreadCursor | null } = {},
): Promise<ThreadPage> {
  const limit = options.limit ?? 50;
  const cursor = options.cursor;

  // The wire cursor is ISO; the column compares as a Postgres literal.
  const cursorValue = cursor ? toColumnTimestamp(cursor.updatedAt) : null;

  // Strict "sorts after the cursor" in (updatedAt DESC, id DESC) order.
  const where =
    cursor && cursorValue
      ? or(
          lt(threads.updatedAt, cursorValue),
          and(eq(threads.updatedAt, cursorValue), lt(threads.id, cursor.id)),
        )
      : undefined;

  const rows = await db
    .select()
    .from(threads)
    .where(where)
    .orderBy(desc(threads.updatedAt), desc(threads.id))
    .limit(limit);

  const records = rows.map(toDomain);
  const full = rows.length === limit;

  // A short FIRST page is provably the whole table; a short later page is only the tail.
  const total =
    !full && !cursor
      ? records.length
      : ((await db.select({ value: count() }).from(threads))[0]?.value ?? records.length);

  const last = rows[rows.length - 1];
  return {
    rows: records,
    total,
    nextCursor:
      full && last ? { updatedAt: columnTimestampToIso(last.updatedAt), id: last.id } : null,
  };
}

export async function getById(id: string): Promise<ThreadRecord | null> {
  const rows = await db.select().from(threads).where(eq(threads.id, id)).limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

/** Create a thread. When `id` is omitted a uuid is generated. */
export async function create(input: { id?: string; title: string }): Promise<ThreadRecord> {
  const timestamp = now();
  const [row] = await db
    .insert(threads)
    .values({
      id: input.id ?? crypto.randomUUID(),
      title: input.title,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();
  return toDomain(row);
}

/** Rename a thread. Returns the updated record, or null if no such thread exists. */
export async function rename(id: string, title: string): Promise<ThreadRecord | null> {
  const [row] = await db
    .update(threads)
    .set({ title, updatedAt: now() })
    .where(eq(threads.id, id))
    .returning();
  return row ? toDomain(row) : null;
}

/** Delete a thread. Returns true if a row was removed, false if it did not exist. */
export async function remove(id: string): Promise<boolean> {
  const rows = await db.delete(threads).where(eq(threads.id, id)).returning({ id: threads.id });
  return rows.length > 0;
}
