import { asc, eq } from "drizzle-orm";
import db from "@/lib/database/db";
import { configs } from "@/lib/database/schema";
import type { ConfigEntry } from "@/types/config";

/**
 * Persistence for owner-level settings. The ONLY ORM seam for the `config` table — callers get
 * plain {@link ConfigEntry} domain objects, never Drizzle rows.
 *
 * Key VALIDITY is not enforced here: the closed catalog lives in `src/lib/config/catalog.ts` and
 * is applied by the tool, so this layer stays a dumb store.
 */

type ConfigRow = typeof configs.$inferSelect;

function toDomain(row: ConfigRow): ConfigEntry {
  return {
    key: row.key,
    value: row.value,
    updatedAt: new Date(row.updatedAt),
  };
}

export async function list(): Promise<ConfigEntry[]> {
  const rows = await db.select().from(configs).orderBy(asc(configs.key));
  return rows.map(toDomain);
}

/** Read one setting. `null` means "never set" — distinct from set-to-empty, which can't happen. */
export async function get(key: string): Promise<ConfigEntry | null> {
  const rows = await db.select().from(configs).where(eq(configs.key, key)).limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

/** Insert or overwrite a setting. Idempotent — re-setting the same value is not an error. */
export async function set(key: string, value: string): Promise<ConfigEntry> {
  const timestamp = new Date().toISOString();
  const [row] = await db
    .insert(configs)
    .values({ key, value, updatedAt: timestamp })
    .onConflictDoUpdate({
      target: configs.key,
      set: { value, updatedAt: timestamp },
    })
    .returning();
  return toDomain(row);
}

/** Delete a setting, reverting it to its catalog fallback. True if a row was removed. */
export async function remove(key: string): Promise<boolean> {
  const rows = await db.delete(configs).where(eq(configs.key, key)).returning({ key: configs.key });
  return rows.length > 0;
}
