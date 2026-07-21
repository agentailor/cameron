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

export interface Transaction {
  id: string;
  occurredAt: Date;
  /** Always-positive minor units (cents). Direction is carried by `type`. */
  amountMinor: number;
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
