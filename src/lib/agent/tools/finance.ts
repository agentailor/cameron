import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as transactionRepo from "@/lib/repositories/transactionRepository";
import * as categoryRepo from "@/lib/repositories/categoryRepository";
import { Account, TransactionType } from "@/types/finance";

/**
 * Built-in finance tools that read/write Cameron's own transaction store. These are registered
 * server-side (see agent/index.ts) so they are always present, and flow through the same
 * human-in-the-loop approval gate as every other tool — logging a transaction is a mutation and
 * will pause for approval.
 */

const DEFAULT_CURRENCY = "USD";

/** Convert a decimal amount (e.g. 12.50) to always-positive minor units (1250 cents). */
function toMinor(amount: number): number {
  return Math.round(Math.abs(amount) * 100);
}

/** Convert minor units back to a display decimal (1250 -> 12.5). */
function toMajor(minor: number): number {
  return minor / 100;
}

/** Resolve a category name to its id, creating the category if it doesn't exist yet. */
async function resolveCategoryId(name?: string | null): Promise<string | null> {
  if (!name || !name.trim()) return null;
  const existing = await categoryRepo.getByName(name.trim());
  if (existing) return existing.id;
  const created = await categoryRepo.create({ name: name.trim() });
  return created.id;
}

const accountEnum = z.enum(["CHECKING", "SAVINGS", "CREDIT", "CASH"]);

export const logExpense = tool(
  async (input) => {
    const categoryId = await resolveCategoryId(input.category);
    const txn = await transactionRepo.create({
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      amountMinor: toMinor(input.amount),
      type: input.type as TransactionType,
      note: input.note,
      currency: input.currency ?? DEFAULT_CURRENCY,
      description: input.description ?? null,
      merchant: input.merchant ?? null,
      categoryId,
      account: input.account as Account,
      source: "manual",
    });
    return JSON.stringify({
      ok: true,
      id: txn.id,
      amount: toMajor(txn.amountMinor),
      type: txn.type,
      note: txn.note,
      account: txn.account,
    });
  },
  {
    name: "log_expense",
    description:
      "Record a single transaction (expense or income) in the user's ledger. A note is required " +
      "— never log an amount without a short human-readable label. This mutates financial records " +
      "and will require the user's approval.",
    schema: z.object({
      amount: z
        .number()
        .positive()
        .describe("The transaction amount as a positive decimal, e.g. 12.50"),
      type: z
        .enum(["expense", "income"])
        .describe("Whether money went out (expense) or in (income)"),
      note: z
        .string()
        .min(1)
        .describe("Required short label for the transaction, e.g. 'Coffee at the corner cafe'"),
      account: accountEnum.describe("Which account the transaction belongs to"),
      currency: z
        .string()
        .optional()
        .describe(`ISO currency code; defaults to ${DEFAULT_CURRENCY}`),
      category: z.string().optional().describe("Category name, e.g. 'Groceries' (created if new)"),
      merchant: z.string().optional().describe("Merchant / payee name"),
      description: z.string().optional().describe("Optional longer detail beyond the note"),
      occurredAt: z
        .string()
        .optional()
        .describe("ISO date/time the transaction happened; defaults to now"),
    }),
  },
);

export const queryTransactions = tool(
  async (input) => {
    // Resolve a category NAME to its id. If the named category doesn't exist, there can be no
    // matching transactions — return an empty result rather than silently dropping the filter.
    let categoryId: string | undefined;
    if (input.category) {
      const cat = await categoryRepo.getByName(input.category);
      if (!cat) return JSON.stringify({ count: 0, transactions: [] });
      categoryId = cat.id;
    }
    const rows = await transactionRepo.list({
      from: input.from,
      to: input.to,
      type: input.type as TransactionType | undefined,
      account: input.account as Account | undefined,
      categoryId,
      text: input.text,
      limit: input.limit,
    });
    const items = rows.map((t) => ({
      id: t.id,
      occurredAt: t.occurredAt.toISOString(),
      amount: toMajor(t.amountMinor),
      type: t.type,
      note: t.note,
      merchant: t.merchant,
      account: t.account,
      currency: t.currency,
    }));
    return JSON.stringify({ count: items.length, transactions: items });
  },
  {
    name: "query_transactions",
    description:
      "Search the user's transactions with optional filters (date range, type, account, category, " +
      "text). Read-only. Returns a bounded list — use filters to narrow results. Prefer the " +
      "`category` filter over `text` when the user names a spending category (e.g. Dining, Groceries).",
    schema: z.object({
      from: z
        .string()
        .optional()
        .describe("ISO date; only transactions on/after this are returned"),
      to: z.string().optional().describe("ISO date; only transactions on/before this are returned"),
      type: z.enum(["expense", "income"]).optional().describe("Filter by expense or income"),
      account: accountEnum.optional().describe("Filter by account"),
      category: z
        .string()
        .optional()
        .describe("Filter by category name, e.g. 'Dining' (exact, case-sensitive)"),
      text: z
        .string()
        .optional()
        .describe("Case-insensitive substring match on note/description/merchant"),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Max rows to return (default 50, hard cap 200)"),
    }),
  },
);

/** All built-in finance tools, registered into the agent in agent/index.ts. */
export const financeTools = [logExpense, queryTransactions];
