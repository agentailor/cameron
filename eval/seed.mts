import { Client } from "pg";
import { randomUUID } from "node:crypto";

/**
 * Deterministic fixture with known totals the graders assert against.
 *
 * Uses raw pg rather than the repositories: the repos read a module-level connection bound to
 * DATABASE_URL at import time, and the eval database's name isn't known until runtime.
 */

/** Ground truth — kept in one place so cases and graders can't disagree with the data. */
const DINING_COUNT = 262;

/** Amounts cycle 1.00…20.00 (see the insert below), so the total is exact and derivable. */
function diningTotalMajor(count: number): number {
  let minor = 0;
  for (let i = 0; i < count; i++) minor += ((i % 20) + 1) * 100;
  return minor / 100;
}

export const FIXTURE = {
  dining: {
    category: "Dining",
    count: DINING_COUNT,
    // Derived from the same formula that seeds the rows — a hardcoded constant silently goes
    // stale the moment the fixture changes, and then the eval fails for the wrong reason.
    totalMajor: diningTotalMajor(DINING_COUNT),
  },
} as const;

export async function seed(url: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const now = new Date().toISOString();
    const categoryId = randomUUID();
    await client.query(
      `INSERT INTO category (id, name, icon, color, created_at, updated_at)
       VALUES ($1, $2, NULL, NULL, $3, $3)`,
      [categoryId, FIXTURE.dining.category, now],
    );

    // Cycle 1.00…20.00 so the total is a known constant, and spread dates across 2026.
    const values: string[] = [];
    const params: unknown[] = [];
    for (let i = 0; i < FIXTURE.dining.count; i++) {
      const amountMinor = ((i % 20) + 1) * 100;
      const occurredAt = new Date(Date.UTC(2026, 0, 1 + (i % 300), 12)).toISOString();
      const base = params.length;
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, 'expense', $${base + 4}, 'USD', NULL, NULL, $${base + 5}, 'CHECKING', 'eval', $${base + 6}, $${base + 7}, $${base + 7})`,
      );
      params.push(
        randomUUID(),
        occurredAt,
        amountMinor,
        `Dining ${i + 1}`,
        categoryId,
        `eval-dining-${i + 1}`,
        now,
      );
    }

    await client.query(
      `INSERT INTO transaction
         (id, occurred_at, amount_minor, type, note, currency, description, merchant,
          category_id, account, source, external_id, created_at, updated_at)
       VALUES ${values.join(", ")}`,
      params,
    );
  } finally {
    await client.end();
  }
}
