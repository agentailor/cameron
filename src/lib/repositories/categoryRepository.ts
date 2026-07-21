import { asc, eq } from "drizzle-orm";
import db from "@/lib/database/db";
import { categories } from "@/lib/database/schema";
import { ConflictError, isUniqueViolation } from "@/lib/database/errors";
import type { Category } from "@/types/finance";

/**
 * Persistence for transaction categories. The ONLY ORM seam for categories — callers get
 * plain {@link Category} domain objects, never Drizzle rows.
 */

type CategoryRow = typeof categories.$inferSelect;

function toDomain(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function now(): string {
  return new Date().toISOString();
}

export interface CreateCategoryInput {
  name: string;
  icon?: string | null;
  color?: string | null;
}

export async function list(): Promise<Category[]> {
  const rows = await db.select().from(categories).orderBy(asc(categories.name));
  return rows.map(toDomain);
}

export async function getById(id: string): Promise<Category | null> {
  const rows = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function getByName(name: string): Promise<Category | null> {
  const rows = await db.select().from(categories).where(eq(categories.name, name)).limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

/** Create a category. Throws {@link ConflictError} if the name is taken. */
export async function create(input: CreateCategoryInput): Promise<Category> {
  const timestamp = now();
  try {
    const [row] = await db
      .insert(categories)
      .values({
        id: crypto.randomUUID(),
        name: input.name,
        icon: input.icon ?? null,
        color: input.color ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning();
    return toDomain(row);
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError("Category name already exists");
    throw err;
  }
}

/** Delete a category. Returns true if a row was removed, false if it did not exist. */
export async function remove(id: string): Promise<boolean> {
  const rows = await db
    .delete(categories)
    .where(eq(categories.id, id))
    .returning({ id: categories.id });
  return rows.length > 0;
}
