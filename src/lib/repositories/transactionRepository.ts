import { and, count, desc, eq, gte, ilike, inArray, lte, or, type SQL } from "drizzle-orm";
import db from "@/lib/database/db";
import { columnToDate } from "@/lib/database/timestamps";
import { categories, transactions } from "@/lib/database/schema";
import { Account, TransactionType, type Transaction } from "@/types/finance";
import type {
  CreateTransactionInput,
  GuardedDeleteResult,
  GuardedUpdateResult,
  ImportResult,
  ImportRow,
  TransactionFilters,
  TransactionPage,
  TransactionPatch,
  TransactionSnapshot,
} from "./transactionTypes";

/**
 * Persistence for transactions — Cameron's system of record. The ONLY ORM seam for
 * transactions; callers get plain {@link Transaction} domain objects, never Drizzle rows.
 *
 * Amounts are always positive, in major units (12.50); direction is carried by `type`.
 * `updatedAt` is app-managed; ids are app-generated. Bulk imports dedup on (source, externalId).
 * Edits are guarded by `updatedAt` (`updateIfUnchanged`, `removeManyIfUnchanged`).
 */

type TransactionRow = typeof transactions.$inferSelect;

function toDomain(row: TransactionRow): Transaction {
  return {
    id: row.id,
    occurredAt: columnToDate(row.occurredAt),
    amount: row.amount,
    type: row.type as TransactionType,
    note: row.note,
    currency: row.currency,
    description: row.description,
    merchant: row.merchant,
    categoryId: row.categoryId,
    account: row.account as Account,
    source: row.source,
    externalId: row.externalId,
    createdAt: columnToDate(row.createdAt),
    updatedAt: columnToDate(row.updatedAt),
  };
}

function now(): string {
  return new Date().toISOString();
}

/** Hard cap so a query can never dump the whole table into the model. */
const MAX_LIMIT = 200;

/** Default page size when the caller doesn't ask for one. */
const DEFAULT_LIMIT = 50;

function toIso(d: Date | string): string {
  return typeof d === "string" ? d : d.toISOString();
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
    amount: input.amount,
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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const snapshotColumns = { row: transactions, categoryName: categories.name };

function toSnapshot(r: { row: TransactionRow; categoryName: string | null }): TransactionSnapshot {
  return { ...toDomain(r.row), categoryName: r.categoryName, version: r.row.updatedAt };
}

/** Rows for these ids, in no particular order. Missing ids are simply absent. */
export async function getManyByIds(ids: string[]): Promise<TransactionSnapshot[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select(snapshotColumns)
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(inArray(transactions.id, ids));
  return rows.map(toSnapshot);
}

/** Locks the rows for the rest of `tx`, so a version check cannot race the write that follows. */
async function lockSnapshots(tx: Tx, ids: string[]): Promise<TransactionSnapshot[]> {
  const rows = await tx
    .select(snapshotColumns)
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(inArray(transactions.id, ids))
    .for("update", { of: transactions });
  return rows.map(toSnapshot);
}

async function resolveCategoryIn(tx: Tx, name: string): Promise<{ id: string; created: boolean }> {
  const [existing] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.name, name));
  if (existing) return { id: existing.id, created: false };
  const ts = now();
  const [inserted] = await tx
    .insert(categories)
    .values({
      id: crypto.randomUUID(),
      name,
      icon: null,
      color: null,
      createdAt: ts,
      updatedAt: ts,
    })
    .onConflictDoNothing({ target: categories.name })
    .returning({ id: categories.id });
  if (inserted) return { id: inserted.id, created: true };
  // Inserted concurrently between the lookup and the insert.
  const [raced] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.name, name));
  return { id: raced.id, created: false };
}

/**
 * Apply `patch` only if the row is still at `version`. The category is resolved in the same
 * transaction, so a stale or failed update never leaves a new category behind.
 */
export async function updateIfUnchanged(
  id: string,
  version: string,
  patch: TransactionPatch,
): Promise<GuardedUpdateResult> {
  return db.transaction(async (tx) => {
    const [before] = await lockSnapshots(tx, [id]);
    if (!before) return { status: "not_found" };
    if (before.version !== version) return { status: "stale" };

    const { categoryName, ...fields } = patch;
    let categoryId: string | null | undefined;
    let categoryCreated: string | null = null;
    if (categoryName === null) categoryId = null;
    else if (categoryName !== undefined) {
      const resolved = await resolveCategoryIn(tx, categoryName);
      categoryId = resolved.id;
      if (resolved.created) categoryCreated = categoryName;
    }

    await tx
      .update(transactions)
      .set({
        ...fields,
        ...(categoryId !== undefined ? { categoryId } : {}),
        updatedAt: now(),
      })
      .where(eq(transactions.id, id));

    const [after] = await lockSnapshots(tx, [id]);
    return { status: "updated", before, after, categoryCreated };
  });
}

/**
 * Delete every row in `expected`, or none: if any is missing or no longer at its version,
 * nothing is deleted. Returns the deleted rows so the caller can echo them.
 */
export async function removeManyIfUnchanged(
  expected: { id: string; version: string }[],
): Promise<GuardedDeleteResult> {
  if (expected.length === 0) return { status: "deleted", rows: [] };
  return db.transaction(async (tx) => {
    const ids = expected.map((e) => e.id);
    const current = new Map((await lockSnapshots(tx, ids)).map((s) => [s.id, s]));

    const missing = ids.filter((id) => !current.has(id));
    if (missing.length > 0) return { status: "not_found", ids: missing };
    const stale = expected.filter((e) => current.get(e.id)!.version !== e.version);
    if (stale.length > 0) return { status: "stale", ids: stale.map((e) => e.id) };

    await tx.delete(transactions).where(inArray(transactions.id, ids));
    return { status: "deleted", rows: ids.map((id) => current.get(id)!) };
  });
}
