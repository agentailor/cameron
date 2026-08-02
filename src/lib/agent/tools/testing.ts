import type { StructuredToolInterface } from "@langchain/core/tools";
import { Account, TransactionType, type Category, type Transaction } from "@/types/finance";

/** Test helpers for the built-in tools. See docs/TESTING.md. */

/**
 * Invoke a tool the way the agent does and parse its JSON payload. Returns an `any`-valued record
 * so tests can reach into nested fields without casting — the trade-off is that a typo'd field
 * name is not a type error, so assert with `toBe`/`toMatchObject`, which still fail on undefined.
 */
export async function callTool<T = Record<string, any>>(
  tool: StructuredToolInterface,
  input: Record<string, unknown> = {},
): Promise<T> {
  const raw = (await tool.invoke(input as never)) as unknown;
  return JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw)) as T;
}

/** Build a Transaction with sensible defaults; override only what the test cares about. */
export function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  const now = new Date("2026-07-05T00:00:00.000Z");
  return {
    id: crypto.randomUUID(),
    occurredAt: now,
    amountMinor: 1250,
    type: TransactionType.expense,
    note: "Coffee",
    currency: "USD",
    description: null,
    merchant: null,
    categoryId: null,
    account: Account.CHECKING,
    source: "manual",
    externalId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Build `count` transactions, each distinguishable by note. */
export function makeTransactions(count: number): Transaction[] {
  return Array.from({ length: count }, (_, i) => makeTransaction({ note: `Transaction ${i + 1}` }));
}

export function makeCategory(overrides: Partial<Category> = {}): Category {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: crypto.randomUUID(),
    name: "Groceries",
    icon: null,
    color: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
