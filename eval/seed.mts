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

/**
 * A CSV fixture designed so a wrong import is *detectable*, not just possible.
 *
 * - Dates are `dd/MM/yyyy` with a day <= 12, so `05/07/2026` is a real date under BOTH readings
 *   (5 July vs 7 May). Guessing wrong produces a clean, successful import on the wrong dates —
 *   no error, no warning. The stored calendar day is the only evidence.
 * - The category header is accented (`Catégorie`); the importer rejects a mapping value that is
 *   not an exact header, so translating it to "Category" imports nothing.
 * - The type column is French, so the agent has to supply `typeValues` rather than rely on the
 *   English defaults.
 */
const CSV_ROWS = [
  { date: "05/07/2026", note: "Café du matin", amount: "4.50", cat: "Dining", type: "Dépense" },
  { date: "06/07/2026", note: "Boulangerie", amount: "12.00", cat: "Groceries", type: "Dépense" },
  {
    date: "07/07/2026",
    note: "Ticket de métro",
    amount: "2.10",
    cat: "Transport",
    type: "Dépense",
  },
  { date: "08/07/2026", note: "Déjeuner", amount: "18.75", cat: "Dining", type: "Dépense" },
  { date: "09/07/2026", note: "Supermarché", amount: "43.20", cat: "Groceries", type: "Dépense" },
  { date: "10/07/2026", note: "Taxi", amount: "27.00", cat: "Transport", type: "Dépense" },
  { date: "11/07/2026", note: "Pizza", amount: "22.40", cat: "Dining", type: "Dépense" },
  { date: "12/07/2026", note: "Cinéma", amount: "15.00", cat: "Loisirs", type: "Dépense" },
] as const;

const CSV_HEADERS = ["Date", "Libellé", "Montant", "Catégorie", "Revenu/dépense"] as const;

function csvText(): string {
  const lines = [CSV_HEADERS.join(",")];
  for (const r of CSV_ROWS) {
    lines.push([r.date, r.note, r.amount, r.cat, r.type].join(","));
  }
  return lines.join("\n") + "\n";
}

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
  /** The uploaded CSV the import cases work from. Seeded into the eval MinIO by `seed()`. */
  csv: {
    fileKey: "eval/fixtures/transactions-fr.csv",
    fileName: "transactions-fr.csv",
    rowCount: CSV_ROWS.length,
    headers: CSV_HEADERS,
    /** Correct reading of the date column — what the agent must confirm before importing. */
    dateFormat: "dd/MM/yyyy",
    /**
     * Under `dd/MM/yyyy` the first row is 5 July; under the wrong `MM/dd/yyyy` it is 7 May. The
     * cases assert on the stored month, which is what separates a right import from a wrong one.
     */
    correctFirstMonth: 7,
    wrongFirstMonth: 5,
    /** Categories in the file. "Loisirs" is new — the import must create it. */
    newCategory: "Loisirs",
  },
} as const;

export async function seed(url: string, opts: { withCsv?: boolean } = {}): Promise<void> {
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

  // The object store is not truncated between runs, so the CSV only needs uploading once.
  if (opts.withCsv !== false) await seedCsvFixture();
}

/**
 * Put the fixture CSV in the eval object store so `inspect_csv` can read it by fileKey.
 *
 * Imported dynamically: `storage/s3-client` throws at module load when the S3 env vars are unset,
 * which would break every read-only case for a file only the import cases need.
 */
async function seedCsvFixture(): Promise<void> {
  const { uploadFile } = await import("../src/lib/storage/upload.ts");
  await uploadFile(
    Buffer.from(csvText(), "utf8"),
    FIXTURE.csv.fileKey,
    "text/csv",
    FIXTURE.csv.fileName,
  );
}
