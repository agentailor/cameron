import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SQL_ROWS } from "@/lib/finance/sqlGuard";
import { callTool } from "./testing";

/** Contract tests for the analytics tools — DB stubbed. Guard rules live in sqlGuard.test.ts. */

vi.mock("@/lib/repositories/analyticsRepository", () => ({
  runReadOnlyQuery: vi.fn(),
}));

const analyticsRepo = await import("@/lib/repositories/analyticsRepository");
const { describeFinanceSchema, runSql } = await import("./analytics");

beforeEach(() => {
  vi.resetAllMocks();
});

describe("describe_finance_schema", () => {
  it("returns both finance tables and the conventions by default", async () => {
    const result = await callTool(describeFinanceSchema, {});

    const names = (result.tables as { table: string }[]).map((t) => t.table);
    expect(names).toEqual(expect.arrayContaining(["transaction", "category"]));
    // The conventions are the whole point — they encode what information_schema can't.
    expect(result.conventions).toEqual(
      expect.arrayContaining([expect.stringMatching(/minor units/i)]),
    );
  });

  it("narrows to a single table to keep context small", async () => {
    const result = await callTool(describeFinanceSchema, { table: "category" });
    expect(result.tables).toHaveLength(1);
    expect((result.tables as { table: string }[])[0].table).toBe("category");
  });

  it("documents that amounts are positive minor units with direction in `type`", async () => {
    const result = await callTool(describeFinanceSchema, { table: "transaction" });
    const columns = (result.tables as { columns: { name: string; note?: string }[] }[])[0].columns;
    const amount = columns.find((c) => c.name === "amount_minor");
    // Getting this wrong produces answers that are wrong by 100x or sign-flipped.
    expect(amount?.note).toMatch(/positive/i);
    expect(amount?.note).toMatch(/100/);
  });
});

describe("run_sql", () => {
  it("returns rows for a valid SELECT", async () => {
    vi.mocked(analyticsRepo.runReadOnlyQuery).mockResolvedValue({
      columns: ["total"],
      rows: [{ total: "4200" }],
      rowCount: 1,
      truncated: false,
    });

    const result = await callTool(runSql, {
      query: "SELECT SUM(amount_minor) AS total FROM transaction",
    });

    expect(result.rows).toEqual([{ total: "4200" }]);
    expect(result.note).toBeUndefined();
  });

  // An aggregate over zero rows returns NULL, which looks identical whether the filtered value
  // exists or not. Without a note the agent guesses, and "you have no X spending yet" wrongly
  // implies X exists.
  it("flags an all-NULL aggregate row as 'no rows matched', not a zero balance", async () => {
    vi.mocked(analyticsRepo.runReadOnlyQuery).mockResolvedValue({
      columns: ["total"],
      rows: [{ total: null }],
      rowCount: 1,
      truncated: false,
    });

    const result = await callTool(runSql, {
      query:
        "SELECT SUM(t.amount_minor) AS total FROM transaction t " +
        "JOIN category c ON c.id = t.category_id WHERE c.name = 'Entertainment'",
    });

    expect(result.note).toBeDefined();
    expect(result.note).toContain("NO rows matched");
    // The actionable half: how to find out whether the name was real.
    expect(result.note).toContain("list_categories");
  });

  it("flags an empty result set the same way", async () => {
    vi.mocked(analyticsRepo.runReadOnlyQuery).mockResolvedValue({
      columns: ["note"],
      rows: [],
      rowCount: 0,
      truncated: false,
    });

    const result = await callTool(runSql, {
      query: "SELECT note FROM transaction WHERE merchant = 'Nowhere'",
    });

    expect(result.note).toBeDefined();
    expect(result.note).toContain("No rows matched");
    expect(result.note).toContain("list_categories");
  });

  it("does not flag a row that has a real value alongside a NULL", async () => {
    vi.mocked(analyticsRepo.runReadOnlyQuery).mockResolvedValue({
      columns: ["category", "total"],
      rows: [{ category: null, total: "4200" }],
      rowCount: 1,
      truncated: false,
    });

    const result = await callTool(runSql, {
      query: "SELECT c.name AS category, SUM(t.amount_minor) AS total FROM transaction t",
    });

    // Uncategorized spend is a real answer — NULL here is data, not an empty result.
    expect(result.note).toBeUndefined();
  });

  it("does not flag multiple rows even when one is all-NULL", async () => {
    vi.mocked(analyticsRepo.runReadOnlyQuery).mockResolvedValue({
      columns: ["category", "total"],
      rows: [
        { category: "Dining", total: "4200" },
        { category: null, total: null },
      ],
      rowCount: 2,
      truncated: false,
    });

    const result = await callTool(runSql, {
      query:
        "SELECT c.name AS category, SUM(t.amount_minor) AS total FROM transaction t GROUP BY 1",
    });

    expect(result.note).toBeUndefined();
  });

  it("tells the agent how to get a complete answer when results are capped", async () => {
    vi.mocked(analyticsRepo.runReadOnlyQuery).mockResolvedValue({
      columns: ["id"],
      rows: [{ id: "1" }],
      rowCount: MAX_SQL_ROWS,
      truncated: true,
    });

    const result = await callTool(runSql, { query: "SELECT id FROM transaction" });

    expect(result.truncated).toBe(true);
    // A bare `truncated: true` doesn't tell the agent what to do next.
    expect(result.note).toEqual(expect.stringMatching(/GROUP BY|aggregate|WHERE/i));
  });

  // A rejected query must READ as a correctable problem, not crash the tool call.
  it("returns a structured error for a non-SELECT instead of throwing", async () => {
    const result = await callTool(runSql, { query: "DELETE FROM transaction" });

    // Rejected at the "must start with SELECT/WITH" check, so the reason states the rule.
    expect(result.error).toEqual(expect.stringMatching(/only select/i));
    expect(analyticsRepo.runReadOnlyQuery).not.toHaveBeenCalled();
  });

  it("names the offending keyword when a write hides inside a SELECT", async () => {
    const result = await callTool(runSql, {
      query: "SELECT 1 FROM transaction WHERE id IN (DELETE FROM category)",
    });

    expect(result.error).toEqual(expect.stringMatching(/DELETE/i));
    expect(analyticsRepo.runReadOnlyQuery).not.toHaveBeenCalled();
  });

  it("returns a structured error when the database rejects the query", async () => {
    vi.mocked(analyticsRepo.runReadOnlyQuery).mockRejectedValue(
      new Error('column "nope" does not exist'),
    );

    const result = await callTool(runSql, { query: "SELECT nope FROM transaction" });

    // Surfacing the real DB message is what lets the agent fix its own SQL.
    expect(result.error).toEqual(expect.stringContaining("nope"));
  });

  it("bounds an unbounded query before running it", async () => {
    vi.mocked(analyticsRepo.runReadOnlyQuery).mockResolvedValue({
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
    });

    await callTool(runSql, { query: "SELECT * FROM transaction" });

    expect(analyticsRepo.runReadOnlyQuery).toHaveBeenCalledWith(
      expect.stringContaining(`LIMIT ${MAX_SQL_ROWS}`),
      MAX_SQL_ROWS,
    );
  });
});
