import { and, count, desc, eq, gte, ilike, inArray, lte, or, type SQL } from "drizzle-orm";
import db from "@/lib/database/db";
import { categories, transactions } from "@/lib/database/schema";
import { Account, TransactionType, type Transaction } from "@/types/finance";

/**
 * Persistence for transactions — Cameron's system of record. The ONLY ORM seam for
 * transactions; callers get plain {@link Transaction} domain objects, never Drizzle rows.
 *
 * Amounts are stored as always-positive minor units (cents); direction is carried by `type`.
 * `updatedAt` is app-managed; ids are app-generated. Bulk imports dedup on (source, externalId).
 */

type TransactionRow = typeof transactions.$inferSelect;

function toDomain(row: TransactionRow): Transaction {
  return {
    id: row.id,
    occurredAt: new Date(row.occurredAt),
    amountMinor: row.amountMinor,
    type: row.type as TransactionType,
    note: row.note,
    currency: row.currency,
    description: row.description,
    merchant: row.merchant,
    categoryId: row.categoryId,
    account: row.account as Account,
    source: row.source,
    externalId: row.externalId,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function now(): string {
  return new Date().toISOString();
}

export interface CreateTransactionInput {
  occurredAt: Date | string;
  amountMinor: number; // always positive
  type: TransactionType;
  note: string;
  currency: string;
  description?: string | null;
  merchant?: string | null;
  categoryId?: string | null;
  account: Account;
  source: string; // "manual" | "csv" | "demobank"
  externalId?: string | null;
}

export interface TransactionFilters {
  from?: Date | string; // occurredAt >= from
  to?: Date | string; // occurredAt <= to
  type?: TransactionType;
  account?: Account;
  categoryId?: string;
  /** Case-insensitive substring match on note / description / merchant. */
  text?: string;
  limit?: number;
}

/** Hard cap so a query can never dump the whole table into the model. */
const MAX_LIMIT = 200;

/** Default page size when the caller doesn't ask for one. */
const DEFAULT_LIMIT = 50;

function toIso(d: Date | string): string {
  return typeof d === "string" ? d : d.toISOString();
}

/**
 * A bounded page plus how many matched. `total` is what makes truncation visible — `rows` alone
 * leaves "50 of 50" and "50 of 847" indistinguishable.
 */
export interface TransactionPage {
  rows: Transaction[];
  /**
   * Total matching the filters, ignoring the limit. Counted only when the page came back full;
   * otherwise it IS `rows.length`. Keep both branches exact — callers derive `truncated` from
   * `total > rows.length`, so an approximation here would misreport truncation.
   */
  total: number;
}

export async function list(filters: TransactionFilters = {}): Promise<TransactionPage> {
  const conditions: SQL[] = [];
  if (filters.from) conditions.push(gte(transactions.occurredAt, toIso(filters.from)));
  if (filters.to) conditions.push(lte(transactions.occurredAt, toIso(filters.to)));
  if (filters.type) conditions.push(eq(transactions.type, filters.type));
  if (filters.account) conditions.push(eq(transactions.account, filters.account));
  if (filters.categoryId) conditions.push(eq(transactions.categoryId, filters.categoryId));
  if (filters.text) {
    const pattern = `%${filters.text}%`;
    const textMatch = or(
      ilike(transactions.note, pattern),
      ilike(transactions.description, pattern),
      ilike(transactions.merchant, pattern),
    );
    if (textMatch) conditions.push(textMatch);
  }

  const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(transactions)
    .where(where)
    .orderBy(desc(transactions.occurredAt))
    .limit(limit);

  // Only pay for the COUNT when the page came back full — a short page cannot be truncated.
  // Not in one transaction with the select: a concurrent insert can make `total` over-report,
  // which is benign (it prompts the agent to narrow, never to over-claim).
  let total = rows.length;
  if (rows.length === limit) {
    const [counted] = await db.select({ value: count() }).from(transactions).where(where);
    total = counted?.value ?? rows.length;
  }

  return { rows: rows.map(toDomain), total };
}

export async function getById(id: string): Promise<Transaction | null> {
  const rows = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

function toValues(input: CreateTransactionInput) {
  const timestamp = now();
  return {
    id: crypto.randomUUID(),
    occurredAt: toIso(input.occurredAt),
    amountMinor: input.amountMinor,
    type: input.type,
    note: input.note,
    currency: input.currency,
    description: input.description ?? null,
    merchant: input.merchant ?? null,
    categoryId: input.categoryId ?? null,
    account: input.account,
    source: input.source,
    externalId: input.externalId ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function create(input: CreateTransactionInput): Promise<Transaction> {
  const [row] = await db.insert(transactions).values(toValues(input)).returning();
  return toDomain(row);
}

/**
 * Bulk insert for imports. Rows whose (source, externalId) already exist are skipped
 * (dedup), so re-importing the same file is idempotent. Returns counts only — callers
 * (e.g. the import tool) surface a summary, never the rows themselves.
 */
export async function createMany(
  inputs: CreateTransactionInput[],
): Promise<{ imported: number; skipped: number }> {
  if (inputs.length === 0) return { imported: 0, skipped: 0 };
  const values = inputs.map(toValues);
  const inserted = await db
    .insert(transactions)
    .values(values)
    .onConflictDoNothing({
      target: [transactions.source, transactions.externalId],
    })
    .returning({ id: transactions.id });
  return { imported: inserted.length, skipped: inputs.length - inserted.length };
}

/** A row to import that still carries its category as a NAME (resolved to an id during import). */
export type ImportRow = CreateTransactionInput & { categoryName?: string | null };

export interface ImportResult {
  imported: number;
  skipped: number;
  categorized: number;
  categoriesCreated: string[];
}

/**
 * Atomic bulk import: resolves categories and inserts transactions in ONE transaction, so a failed
 * insert rolls back any categories created. Category names are resolved in bulk (one lookup + one
 * insert for the distinct set), not per row.
 */
export async function importWithCategories(rows: ImportRow[]): Promise<ImportResult> {
  if (rows.length === 0) {
    return { imported: 0, skipped: 0, categorized: 0, categoriesCreated: [] };
  }

  return db.transaction(async (tx) => {
    const names = [
      ...new Set(rows.map((r) => r.categoryName?.trim()).filter((n): n is string => Boolean(n))),
    ];

    const nameToId = new Map<string, string>();
    const createdCategories: string[] = [];

    if (names.length > 0) {
      const existing = await tx
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .where(inArray(categories.name, names));
      for (const c of existing) nameToId.set(c.name, c.id);

      const missing = names.filter((n) => !nameToId.has(n));
      if (missing.length > 0) {
        const ts = now();
        const inserted = await tx
          .insert(categories)
          .values(
            missing.map((name) => ({
              id: crypto.randomUUID(),
              name,
              icon: null,
              color: null,
              createdAt: ts,
              updatedAt: ts,
            })),
          )
          .onConflictDoNothing({ target: categories.name })
          .returning({ id: categories.id, name: categories.name });
        for (const c of inserted) {
          nameToId.set(c.name, c.id);
          createdCategories.push(c.name);
        }
        // onConflictDoNothing skips names inserted concurrently — fetch their ids.
        const stillMissing = missing.filter((n) => !nameToId.has(n));
        if (stillMissing.length > 0) {
          const refetched = await tx
            .select({ id: categories.id, name: categories.name })
            .from(categories)
            .where(inArray(categories.name, stillMissing));
          for (const c of refetched) nameToId.set(c.name, c.id);
        }
      }
    }

    let categorized = 0;
    const values = rows.map((row) => {
      const name = row.categoryName?.trim();
      const categoryId = name ? (nameToId.get(name) ?? null) : null;
      if (categoryId) categorized++;
      const { categoryName: _categoryName, ...input } = row;
      void _categoryName;
      return toValues({ ...input, categoryId });
    });

    const inserted = await tx
      .insert(transactions)
      .values(values)
      .onConflictDoNothing({ target: [transactions.source, transactions.externalId] })
      .returning({ id: transactions.id });

    return {
      imported: inserted.length,
      skipped: rows.length - inserted.length,
      categorized,
      categoriesCreated: createdCategories,
    };
  });
}

/** Delete a transaction. Returns true if a row was removed, false if it did not exist. */
export async function remove(id: string): Promise<boolean> {
  const rows = await db
    .delete(transactions)
    .where(eq(transactions.id, id))
    .returning({ id: transactions.id });
  return rows.length > 0;
}
