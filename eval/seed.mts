import { Client } from "pg";
import { randomUUID } from "node:crypto";

/**
 * Deterministic fixture with known totals the graders assert against.
 *
 * Uses raw pg rather than the repositories: the repos read a module-level connection bound to
 * DATABASE_URL at import time, and the eval database's name isn't known until runtime.
 */

/**
 * Ground truth. Sizes are load-bearing, not arbitrary:
 *
 * - Dining (262) deliberately exceeds `query_transactions`' 200-row cap, so any attempt to total it
 *   by listing MUST truncate. That trap is the whole point of the truncation case.
 * - Groceries (40) and Transport (12) stay well under the cap, so they never truncate — and they
 *   give the ranking case something to actually rank. Their totals are distinct and ordered, so
 *   "biggest category" has one correct answer.
 */
const SPEND = [
  { category: "Dining", count: 262, cycle: 20 },
  { category: "Groceries", count: 40, cycle: 12 },
  { category: "Transport", count: 12, cycle: 5 },
] as const;

/** A little income, so `type = 'expense'` filtering is a real discriminator and not a no-op. */
const INCOME = [
  { note: "Salary", amountMinor: 500_000 },
  { note: "Freelance invoice", amountMinor: 125_000 },
] as const;

/**
 * Amounts cycle 1.00…cycle.00 (see the insert below), so every total is exact and derivable.
 * Hardcoding these constants would silently go stale the moment the fixture changes, and then the
 * eval fails for the wrong reason.
 */
function cycledTotalMajor(count: number, cycle: number): number {
  let minor = 0;
  for (let i = 0; i < count; i++) minor += ((i % cycle) + 1) * 100;
  return minor / 100;
}

function spendFixture({ category, count, cycle }: (typeof SPEND)[number]) {
  return { category, count, cycle, totalMajor: cycledTotalMajor(count, cycle) };
}

const dining = spendFixture(SPEND[0]);
const groceries = spendFixture(SPEND[1]);
const transport = spendFixture(SPEND[2]);

export const FIXTURE = {
  dining,
  groceries,
  transport,
  /** Every seeded category, biggest spend first — the ranking case's expected order. */
  categoriesBySpend: [dining, groceries, transport].sort((a, b) => b.totalMajor - a.totalMajor),
  /** Seeded expense rows across all categories. The approval cases assert deltas against this. */
  expenseCount: SPEND.reduce((n, s) => n + s.count, 0),
  incomeCount: INCOME.length,
  transactionCount: SPEND.reduce((n, s) => n + s.count, 0) + INCOME.length,
  /**
   * A category name that is NOT seeded. The recovery case asks about it: `query_transactions`
   * reports it as unknown, and the agent must not read that as "you have no transactions".
   */
  unknownCategory: "Entertainment",
} as const;

export async function seed(url: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const now = new Date().toISOString();

    const categoryIds = new Map<string, string>();
    for (const { category } of SPEND) {
      const id = randomUUID();
      categoryIds.set(category, id);
      await client.query(
        `INSERT INTO category (id, name, icon, color, created_at, updated_at)
         VALUES ($1, $2, NULL, NULL, $3, $3)`,
        [id, category, now],
      );
    }

    const values: string[] = [];
    const params: unknown[] = [];
    const addRow = (row: {
      occurredAt: string;
      amountMinor: number;
      type: "expense" | "income";
      note: string;
      categoryId: string | null;
      externalId: string;
    }) => {
      const base = params.length;
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, 'USD', NULL, NULL, ` +
          `$${base + 6}, 'CHECKING', 'eval', $${base + 7}, $${base + 8}, $${base + 8})`,
      );
      params.push(
        randomUUID(),
        row.occurredAt,
        row.amountMinor,
        row.type,
        row.note,
        row.categoryId,
        row.externalId,
        now,
      );
    };

    // Cycle 1.00…cycle.00 so each category's total is a known constant, and spread dates across 2026.
    for (const { category, count, cycle } of SPEND) {
      for (let i = 0; i < count; i++) {
        addRow({
          occurredAt: new Date(Date.UTC(2026, 0, 1 + (i % 300), 12)).toISOString(),
          amountMinor: ((i % cycle) + 1) * 100,
          type: "expense",
          note: `${category} ${i + 1}`,
          categoryId: categoryIds.get(category) ?? null,
          externalId: `eval-${category.toLowerCase()}-${i + 1}`,
        });
      }
    }

    // Income is uncategorized on purpose — it also covers COALESCE(name,'Uncategorized') in SQL.
    INCOME.forEach((row, i) => {
      addRow({
        occurredAt: new Date(Date.UTC(2026, i, 28, 12)).toISOString(),
        amountMinor: row.amountMinor,
        type: "income",
        note: row.note,
        categoryId: null,
        externalId: `eval-income-${i + 1}`,
      });
    });

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
