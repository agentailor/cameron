// Must be first: loads .env.local before db.ts (imported transitively below) builds its pg pool.
import "@/lib/database/loadEnv";
import * as categoryRepo from "@/lib/repositories/categoryRepository";
import * as transactionRepo from "@/lib/repositories/transactionRepository";
import { Account, TransactionType } from "@/types/finance";
import { ConflictError } from "@/lib/database/errors";

/**
 * Seeds a fresh Cameron database with a handful of categories and a few months of sample
 * transactions, so a new clone shows a populated, reader-reproducible demo. Idempotent:
 * categories skip on conflict, and transactions dedup on (source, externalId), so running it
 * repeatedly is safe.
 *
 * Run with: `pnpm db:seed`
 */

const CATEGORIES = ["Groceries", "Dining", "Transport", "Utilities", "Entertainment", "Income"];

// Deterministic sample: a stable externalId per row keeps re-seeding idempotent.
interface SeedTxn {
  daysAgo: number;
  amount: number; // positive decimal
  type: TransactionType;
  note: string;
  category: string;
  account: Account;
  merchant?: string;
}

const SAMPLE: SeedTxn[] = [
  {
    daysAgo: 2,
    amount: 12.5,
    type: TransactionType.expense,
    note: "Morning coffee",
    category: "Dining",
    account: Account.CHECKING,
    merchant: "Blue Bottle",
  },
  {
    daysAgo: 3,
    amount: 84.32,
    type: TransactionType.expense,
    note: "Weekly groceries",
    category: "Groceries",
    account: Account.CHECKING,
    merchant: "Whole Foods",
  },
  {
    daysAgo: 5,
    amount: 40.0,
    type: TransactionType.expense,
    note: "Gas fill-up",
    category: "Transport",
    account: Account.CREDIT,
    merchant: "Shell",
  },
  {
    daysAgo: 7,
    amount: 15.99,
    type: TransactionType.expense,
    note: "Streaming subscription",
    category: "Entertainment",
    account: Account.CREDIT,
    merchant: "Netflix",
  },
  {
    daysAgo: 12,
    amount: 120.0,
    type: TransactionType.expense,
    note: "Electricity bill",
    category: "Utilities",
    account: Account.CHECKING,
    merchant: "PG&E",
  },
  {
    daysAgo: 15,
    amount: 2500.0,
    type: TransactionType.income,
    note: "Paycheck",
    category: "Income",
    account: Account.CHECKING,
    merchant: "Employer",
  },
  {
    daysAgo: 20,
    amount: 9.75,
    type: TransactionType.expense,
    note: "Lunch",
    category: "Dining",
    account: Account.CHECKING,
    merchant: "Chipotle",
  },
  {
    daysAgo: 25,
    amount: 62.4,
    type: TransactionType.expense,
    note: "Grocery run",
    category: "Groceries",
    account: Account.CHECKING,
    merchant: "Trader Joe's",
  },
  {
    daysAgo: 34,
    amount: 28.0,
    type: TransactionType.expense,
    note: "Ride share",
    category: "Transport",
    account: Account.CREDIT,
    merchant: "Uber",
  },
  {
    daysAgo: 45,
    amount: 2500.0,
    type: TransactionType.income,
    note: "Paycheck",
    category: "Income",
    account: Account.CHECKING,
    merchant: "Employer",
  },
];

async function seedCategories(): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  for (const name of CATEGORIES) {
    try {
      const created = await categoryRepo.create({ name });
      byName.set(name, created.id);
    } catch (err) {
      if (err instanceof ConflictError) {
        const existing = await categoryRepo.getByName(name);
        if (existing) byName.set(name, existing.id);
      } else {
        throw err;
      }
    }
  }
  return byName;
}

async function seedTransactions(categoryIds: Map<string, string>) {
  const now = Date.now();
  const inputs = SAMPLE.map((t, i) => {
    const occurredAt = new Date(now - t.daysAgo * 24 * 60 * 60 * 1000);
    return {
      occurredAt,
      amountMinor: Math.round(t.amount * 100),
      type: t.type,
      note: t.note,
      currency: "USD",
      merchant: t.merchant ?? null,
      categoryId: categoryIds.get(t.category) ?? null,
      account: t.account,
      source: "demobank",
      // Stable id -> idempotent re-seed via createMany's onConflictDoNothing.
      externalId: `seed-${i}`,
    };
  });
  return transactionRepo.createMany(inputs);
}

async function main() {
  const categoryIds = await seedCategories();
  const { imported, skipped } = await seedTransactions(categoryIds);
  console.log(
    `Seed complete. Categories: ${categoryIds.size}. Transactions imported: ${imported}, skipped (already present): ${skipped}.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
