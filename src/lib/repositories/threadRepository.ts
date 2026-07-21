import { desc, eq } from "drizzle-orm";
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
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function now(): string {
  return new Date().toISOString();
}

export async function list(limit = 50): Promise<ThreadRecord[]> {
  const rows = await db.select().from(threads).orderBy(desc(threads.updatedAt)).limit(limit);
  return rows.map(toDomain);
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
