import { asc, count as countRows, eq, inArray, sql } from "drizzle-orm";
import db from "@/lib/database/db";
import { columnToDate } from "@/lib/database/timestamps";
import { memories } from "@/lib/database/schema";
import { isUniqueViolation } from "@/lib/database/errors";
import type { CreateMemoryInput, CreateMemoryResult, Memory } from "@/types/memory";

/**
 * Persistence for remembered preferences. The ONLY ORM seam for the `memory` table — callers get
 * plain {@link Memory} domain objects, never Drizzle rows.
 *
 * Limits (length, how many) are the tool's, so this layer stays a dumb store.
 */

type MemoryRow = typeof memories.$inferSelect;

function toDomain(row: MemoryRow): Memory {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    sourceThreadId: row.sourceThreadId,
    createdAt: columnToDate(row.createdAt),
    updatedAt: columnToDate(row.updatedAt),
  };
}

/** Oldest first, so the prompt's list only changes at the end when a memory is added. */
export async function list(): Promise<Memory[]> {
  const rows = await db.select().from(memories).orderBy(asc(memories.createdAt), asc(memories.id));
  return rows.map(toDomain);
}

/** The memories with these ids that exist; the caller reports the rest by id. */
export async function getMany(ids: string[]): Promise<Memory[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(memories)
    .where(inArray(memories.id, ids))
    .orderBy(asc(memories.createdAt), asc(memories.id));
  return rows.map(toDomain);
}

export async function getByTitle(title: string): Promise<Memory | null> {
  const rows = await db
    .select()
    .from(memories)
    .where(eq(sql`lower(${memories.title})`, title.toLowerCase()))
    .limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function count(): Promise<number> {
  const [row] = await db.select({ n: countRows() }).from(memories);
  return row?.n ?? 0;
}

/** Save a memory. A title already taken (ignoring case) returns the memory holding it. */
export async function create(input: CreateMemoryInput): Promise<CreateMemoryResult> {
  const timestamp = new Date().toISOString();
  try {
    const [row] = await db
      .insert(memories)
      .values({
        id: crypto.randomUUID(),
        title: input.title,
        content: input.content,
        sourceThreadId: input.sourceThreadId ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning();
    return { ok: true, memory: toDomain(row) };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const existing = await getByTitle(input.title);
    // Deleted between the insert and the lookup: vanishingly rare, so surface it.
    if (!existing) throw err;
    return { ok: false, reason: "duplicate_title", existing };
  }
}

/** Delete these memories. Returns the ids actually removed; the caller reports the rest. */
export async function removeMany(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .delete(memories)
    .where(inArray(memories.id, ids))
    .returning({ id: memories.id });
  return rows.map((r) => r.id);
}
