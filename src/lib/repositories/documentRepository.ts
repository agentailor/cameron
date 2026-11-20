import { eq } from "drizzle-orm";
import db from "@/lib/database/db";
import { columnToDate } from "@/lib/database/timestamps";
import { documents } from "@/lib/database/schema";
import type { DocumentReading, DocumentRecord } from "@/types/document";

/** The ONLY ORM seam for the `document` table. Callers get {@link DocumentRecord}s. */

type DocumentRow = typeof documents.$inferSelect;

function toDomain(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    fileKey: row.fileKey,
    contentHash: row.contentHash,
    mimeType: row.mimeType,
    reading: row.reading,
    readWith: row.readWith,
    createdAt: columnToDate(row.createdAt),
    updatedAt: columnToDate(row.updatedAt),
  };
}

export async function getById(id: string): Promise<DocumentRecord | null> {
  const rows = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function getByHash(contentHash: string): Promise<DocumentRecord | null> {
  const rows = await db
    .select()
    .from(documents)
    .where(eq(documents.contentHash, contentHash))
    .limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

export interface NewDocument {
  fileKey: string;
  contentHash: string;
  mimeType: string;
  reading: DocumentReading;
  readWith: string;
}

/**
 * Store a reading. If the same bytes were stored meanwhile (two reads racing), the row that got
 * there first wins and is returned, so a hash never maps to two readings.
 */
export async function create(input: NewDocument): Promise<DocumentRecord> {
  const timestamp = new Date().toISOString();
  const [row] = await db
    .insert(documents)
    .values({ id: crypto.randomUUID(), ...input, updatedAt: timestamp })
    .onConflictDoNothing({ target: documents.contentHash })
    .returning();
  if (row) return toDomain(row);
  const existing = await getByHash(input.contentHash);
  if (!existing) throw new Error(`document for hash ${input.contentHash} vanished after conflict`);
  return existing;
}
