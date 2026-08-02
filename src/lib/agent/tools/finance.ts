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

/**
 * Resolve a category name to its id, creating it if new. Reports `created` so the caller can
 * surface a category coined as a side effect of logging.
 */
async function resolveCategory(
  name?: string | null,
): Promise<{ id: string | null; name: string | null; created: boolean }> {
  const trimmed = name?.trim();
  if (!trimmed) return { id: null, name: null, created: false };
  const existing = await categoryRepo.getByName(trimmed);
  if (existing) return { id: existing.id, name: existing.name, created: false };
  const created = await categoryRepo.create({ name: trimmed });
  return { id: created.id, name: created.name, created: true };
}

const accountEnum = z.enum(["CHECKING", "SAVINGS", "CREDIT", "CASH"]);

export const logExpense = tool(
  async (input) => {
    const category = await resolveCategory(input.category);
    const txn = await transactionRepo.create({
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      amountMinor: toMinor(input.amount),
      type: input.type as TransactionType,
      note: input.note,
      currency: input.currency ?? DEFAULT_CURRENCY,
      description: input.description ?? null,
      merchant: input.merchant ?? null,
      categoryId: category.id,
      account: input.account as Account,
      source: "manual",
    });
    // Echo resolved values (not inputs) so the agent can confirm what was written.
    return JSON.stringify({
      ok: true,
      id: txn.id,
      occurredAt: txn.occurredAt.toISOString(),
      amount: toMajor(txn.amountMinor),
      type: txn.type,
      note: txn.note,
      account: txn.account,
      currency: txn.currency,
      category: category.name,
      ...(category.created ? { categoryCreated: category.name } : {}),
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
      category: z
        .string()
        .optional()
        .describe(
          "Category name, e.g. 'Groceries'. If no category with this exact name exists it will " +
            "be CREATED — call `list_categories` first and reuse an existing name rather than " +
            "coining a near-duplicate. The response reports any category it had to create.",
        ),
      merchant: z.string().optional().describe("Merchant / payee name"),
      description: z.string().optional().describe("Optional longer detail beyond the note"),
      occurredAt: z
        .string()
        .optional()
        .describe(
          "ISO date or date-time the transaction happened, e.g. '2026-08-01' or " +
            "'2026-08-01T14:30:00Z'. Defaults to now when omitted.",
        ),
    }),
  },
);

export const queryTransactions = tool(
  async (input) => {
    // An unknown category must say so — a bare empty result reads as "you have no transactions".
    let categoryId: string | undefined;
    if (input.category) {
      const cat = await categoryRepo.getByName(input.category);
      if (!cat) {
        return JSON.stringify({
          returned: 0,
          matched: 0,
          truncated: false,
          transactions: [],
          note:
            `No category named "${input.category}" exists (the match is exact and ` +
            "case-sensitive). Call list_categories to see the valid names, then retry.",
        });
      }
      categoryId = cat.id;
    }
    const { rows, total } = await transactionRepo.list({
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
    // Truncation must be visible, or the agent mistakes a capped page for the whole set.
    const truncated = total > items.length;
    return JSON.stringify({
      returned: items.length,
      matched: total,
      truncated,
      transactions: items,
      ...(truncated
        ? {
            hint:
              `Showing the ${items.length} most recent of ${total} matching transactions. ` +
              "Narrow the date range, add a category/account filter, or raise `limit` (max 200). " +
              "For a total or a ranking across ALL matches, use run_sql instead — do not add up " +
              "these rows.",
          }
        : {}),
    });
  },
  {
    name: "query_transactions",
    description:
      "Search the user's transactions with optional filters (date range, type, account, category, " +
      "text). Read-only. Use this to LIST matching transactions, never to compute totals or " +
      "rankings — for those use `run_sql`. Returns `{ returned, matched, truncated, transactions }`: " +
      "`matched` is how many exist in total, `returned` how many are in this response. When " +
      "`truncated` is true you are seeing a PARTIAL set — never sum or count these rows as if they " +
      "were complete; follow the `hint` to narrow the query or switch to `run_sql`. Prefer the " +
      "`category` filter over `text` when the user names a spending category (e.g. Dining, Groceries).",
    schema: z.object({
      from: z
        .string()
        .optional()
        .describe(
          "ISO date; only transactions on/after this are returned (inclusive). " +
            "Example: '2026-01-01'.",
        ),
      to: z
        .string()
        .optional()
        .describe(
          "ISO date; only transactions on/before this are returned (inclusive). " +
            "Example: '2026-06-30'.",
        ),
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
