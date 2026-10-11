import type { Account, Transaction, TransactionType } from "@/types/finance";

/**
 * The transaction repository's contract: what it accepts and what it returns, beside it so callers
 * can name these types without pulling in the repository (and its database client).
 */

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

/** A row to import that still carries its category as a NAME (resolved to an id during import). */
export type ImportRow = CreateTransactionInput & { categoryName?: string | null };

export interface ImportResult {
  imported: number;
  skipped: number;
  categorized: number;
  categoriesCreated: string[];
}

/**
 * A transaction as an edit sees it: the row, its category NAME, and `version` — the raw
 * `updated_at` literal. Edits compare `version` as the driver returned it, never round-tripped
 * through `Date` (see the timestamp note in AGENTS.md).
 */
export type TransactionSnapshot = Transaction & { categoryName: string | null; version: string };

/** Fields an edit may change. `undefined` leaves a field alone. */
export interface TransactionPatch {
  occurredAt?: string;
  amountMinor?: number;
  type?: TransactionType;
  note?: string;
  currency?: string;
  account?: Account;
  merchant?: string | null;
  description?: string | null;
  /** A category NAME, created if new; `null` uncategorizes. */
  categoryName?: string | null;
}

export type GuardedUpdateResult =
  | {
      status: "updated";
      before: TransactionSnapshot;
      after: TransactionSnapshot;
      categoryCreated: string | null;
    }
  | { status: "not_found" }
  | { status: "stale" };

export type GuardedDeleteResult =
  | { status: "deleted"; rows: TransactionSnapshot[] }
  | { status: "not_found"; ids: string[] }
  | { status: "stale"; ids: string[] };
