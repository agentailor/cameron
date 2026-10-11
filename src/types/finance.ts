/**
 * Domain types for Cameron's finance store, returned by the finance repositories so callers
 * never depend on Drizzle row types. Mirrors the conventions in `./mcp.ts` (timestamps as
 * `Date`, nullable columns as `| null`).
 */

/** Account the transaction belongs to. Mirrors the `account` pg enum. */
export enum Account {
  CHECKING = "CHECKING",
  SAVINGS = "SAVINGS",
  CREDIT = "CREDIT",
  CASH = "CASH",
}

/** Direction of a transaction. Mirrors the `transaction_type` pg enum. */
export enum TransactionType {
  expense = "expense",
  income = "income",
}

export interface Category {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A transaction as the agent and the UI see it: major units, category by name, ISO date. The edit
 * tools return it and the approval card renders it, so both show the same fields.
 */
export interface TransactionView {
  id: string;
  occurredAt: string;
  amount: number;
  type: string;
  note: string;
  currency: string;
  account: string;
  category: string | null;
  merchant: string | null;
  description: string | null;
  source: string;
}

export interface Transaction {
  id: string;
  occurredAt: Date;
  /** Always positive, in major units (12.50). Direction is carried by `type`. */
  amount: number;
  type: TransactionType;
  /** Required short human-readable label. */
  note: string;
  currency: string;
  description: string | null;
  merchant: string | null;
  categoryId: string | null;
  account: Account;
  /** Provenance: "manual" | "csv" | "demobank" (free text). */
  source: string;
  /** Source-native id used to dedup re-imports; null for manually logged rows. */
  externalId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
