import { beforeEach, describe, expect, it, vi } from "vitest";
import { Account, TransactionType } from "@/types/finance";
import { callTool, makeCategory, makeTransaction, makeTransactions } from "./testing";

/** Contract tests for the finance tools — repositories stubbed. See docs/TESTING.md. */

vi.mock("@/lib/repositories/transactionRepository", () => ({
  create: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@/lib/repositories/categoryRepository", () => ({
  create: vi.fn(),
  getByName: vi.fn(),
}));

const transactionRepo = await import("@/lib/repositories/transactionRepository");
const categoryRepo = await import("@/lib/repositories/categoryRepository");
const { logExpense, queryTransactions } = await import("./finance");

beforeEach(() => {
  vi.resetAllMocks();
});

describe("query_transactions", () => {
  it("returns matching transactions with amounts in major units", async () => {
    vi.mocked(transactionRepo.list).mockResolvedValue({
      rows: [makeTransaction({ amountMinor: 1250, note: "Coffee" })],
      total: 1,
    });

    const result = await callTool(queryTransactions, {});

    expect(result).toMatchObject({ returned: 1, matched: 1, truncated: false });
    expect(result.transactions).toHaveLength(1);
    // The agent sees major units, never cents.
    expect(result.transactions[0]).toMatchObject({ amount: 12.5, note: "Coffee" });
  });

  // The regression this suite exists for: a capped page must not read as a complete result.
  it("tells the agent when results were truncated, and how to narrow them", async () => {
    vi.mocked(transactionRepo.list).mockResolvedValue({
      rows: makeTransactions(200),
      total: 847,
    });

    const result = await callTool(queryTransactions, { from: "2026-01-01" });

    expect(result.returned).toBe(200);
    expect(result.matched).toBe(847);
    expect(result.truncated).toBe(true);
    // "truncated" alone isn't enough — the hint must give the next move.
    expect(result.hint).toEqual(expect.stringContaining("847"));
    expect(result.hint).toEqual(expect.stringMatching(/narrow|filter|run_sql/i));
  });

  it("does not claim truncation when the result is complete", async () => {
    vi.mocked(transactionRepo.list).mockResolvedValue({
      rows: makeTransactions(12),
      total: 12,
    });

    const result = await callTool(queryTransactions, {});

    expect(result).toMatchObject({ returned: 12, matched: 12, truncated: false });
    expect(result.hint).toBeUndefined();
  });

  // An unknown category and a known-but-empty one used to look identical to the agent.
  it("distinguishes an unknown category from a category with no transactions", async () => {
    vi.mocked(categoryRepo.getByName).mockResolvedValue(null);

    const result = await callTool(queryTransactions, { category: "Dning" });

    expect(result.returned).toBe(0);
    expect(result.transactions).toEqual([]);
    expect(result.note).toEqual(expect.stringContaining("Dning"));
    expect(result.note).toEqual(expect.stringContaining("list_categories"));
    expect(transactionRepo.list).not.toHaveBeenCalled();
  });

  it("reports an existing category with no matches as a genuine empty result", async () => {
    vi.mocked(categoryRepo.getByName).mockResolvedValue(makeCategory({ name: "Dining" }));
    vi.mocked(transactionRepo.list).mockResolvedValue({ rows: [], total: 0 });

    const result = await callTool(queryTransactions, { category: "Dining" });

    expect(result).toMatchObject({ returned: 0, matched: 0, truncated: false });
    expect(result.note).toBeUndefined();
  });

  it("passes filters through to the repository", async () => {
    vi.mocked(transactionRepo.list).mockResolvedValue({ rows: [], total: 0 });

    await callTool(queryTransactions, {
      from: "2026-01-01",
      to: "2026-06-30",
      type: "expense",
      account: "CREDIT",
      text: "coffee",
      limit: 10,
    });

    expect(transactionRepo.list).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "2026-01-01",
        to: "2026-06-30",
        type: TransactionType.expense,
        account: Account.CREDIT,
        text: "coffee",
        limit: 10,
      }),
    );
  });
});

describe("log_expense", () => {
  it("echoes back everything it recorded so the agent can confirm it", async () => {
    const occurredAt = new Date("2026-07-05T09:30:00.000Z");
    vi.mocked(categoryRepo.getByName).mockResolvedValue(makeCategory({ name: "Coffee" }));
    vi.mocked(transactionRepo.create).mockResolvedValue(
      makeTransaction({ amountMinor: 450, note: "Café du coin", occurredAt, currency: "EUR" }),
    );

    const result = await callTool(logExpense, {
      amount: 4.5,
      type: "expense",
      note: "Café du coin",
      account: "CHECKING",
      currency: "EUR",
      category: "Coffee",
    });

    // The agent needs the resolved values to confirm what was written.
    expect(result).toMatchObject({
      ok: true,
      amount: 4.5,
      note: "Café du coin",
      currency: "EUR",
      category: "Coffee",
      occurredAt: occurredAt.toISOString(),
    });
  });

  it("converts a decimal amount to positive minor units", async () => {
    vi.mocked(transactionRepo.create).mockResolvedValue(makeTransaction({ amountMinor: 1299 }));

    await callTool(logExpense, {
      amount: 12.99,
      type: "expense",
      note: "Lunch",
      account: "CASH",
    });

    expect(transactionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ amountMinor: 1299, type: TransactionType.expense }),
    );
  });

  // log_expense creates categories inline, while create_category is approval-gated.
  it("reports when logging created a new category as a side effect", async () => {
    vi.mocked(categoryRepo.getByName).mockResolvedValue(null);
    vi.mocked(categoryRepo.create).mockResolvedValue(makeCategory({ name: "Coffee Shops" }));
    vi.mocked(transactionRepo.create).mockResolvedValue(makeTransaction());

    const result = await callTool(logExpense, {
      amount: 12.5,
      type: "expense",
      note: "Coffee",
      account: "CHECKING",
      category: "Coffee Shops",
    });

    expect(result.categoryCreated).toBe("Coffee Shops");
  });
});
