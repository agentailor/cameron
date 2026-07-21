import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { runReadOnlyQuery } from "@/lib/repositories/analyticsRepository";
import { validateSelect, enforceLimit, MAX_SQL_ROWS } from "@/lib/finance/sqlGuard";

/**
 * Analytics tools for open-ended aggregate questions the fixed queries can't answer. Both are
 * read-only and auto-approve; `run_sql` cannot mutate — see the guard stack in `sqlGuard.ts` and
 * `analyticsRepository.ts`.
 */

// Curated (not introspected) so it can encode conventions information_schema can't (minor units,
// direction via `type`). TODO(scale): derive column lists from Drizzle metadata when the schema
// outgrows a hand-written doc.
interface ColumnDoc {
  name: string;
  type: string;
  nullable: boolean;
  note?: string;
}
interface TableDoc {
  table: string;
  description: string;
  columns: ColumnDoc[];
}

const TABLES: Record<string, TableDoc> = {
  transaction: {
    table: "transaction",
    description: "The system of record — one row per transaction.",
    columns: [
      { name: "id", type: "text", nullable: false, note: "primary key" },
      { name: "occurred_at", type: "timestamp", nullable: false, note: "when it happened — use for date filters/grouping" },
      { name: "amount_minor", type: "integer", nullable: false, note: "ALWAYS POSITIVE, minor units (cents). Divide by 100.0 to display. Direction is `type`, NOT the sign." },
      { name: "type", type: "enum('expense','income')", nullable: false },
      { name: "note", type: "text", nullable: false, note: "short human label" },
      { name: "currency", type: "text", nullable: false, note: "ISO code, e.g. 'USD','EUR'" },
      { name: "description", type: "text", nullable: true },
      { name: "merchant", type: "text", nullable: true },
      { name: "category_id", type: "text", nullable: true, note: "FK -> category.id; NULL = uncategorized" },
      { name: "account", type: "enum('CHECKING','SAVINGS','CREDIT','CASH')", nullable: false },
      { name: "source", type: "text", nullable: false, note: "provenance: 'manual' | 'csv' | 'demobank'" },
      { name: "external_id", type: "text", nullable: true, note: "source-native id" },
      { name: "created_at", type: "timestamp", nullable: false, note: "row insert time — usually prefer occurred_at" },
      { name: "updated_at", type: "timestamp", nullable: false },
    ],
  },
  category: {
    table: "category",
    description: "Transaction categories.",
    columns: [
      { name: "id", type: "text", nullable: false, note: "primary key" },
      { name: "name", type: "text", nullable: false, note: "unique" },
      { name: "icon", type: "text", nullable: true },
      { name: "color", type: "text", nullable: true },
    ],
  },
};

const CONVENTIONS = [
  "Spend total: SUM(amount_minor)/100.0 with type = 'expense'.",
  "Category names: JOIN category c ON c.id = t.category_id; NULL category_id is uncategorized (COALESCE(c.name,'Uncategorized')).",
  "Date ranges: filter on occurred_at (e.g. occurred_at >= date_trunc('month', now()) - interval '1 month').",
  "Amounts are minor units — convert to major units (÷100) before showing figures.",
];

export const describeFinanceSchema = tool(
  async (input) => {
    const requested = input.table;
    const tables = requested ? [TABLES[requested]].filter(Boolean) : Object.values(TABLES);
    if (requested && tables.length === 0) {
      return JSON.stringify({
        error: `Unknown table "${requested}"`,
        availableTables: Object.keys(TABLES),
      });
    }
    return JSON.stringify({ tables, conventions: CONVENTIONS });
  },
  {
    name: "describe_finance_schema",
    description:
      "Return the structured schema of the finance tables (transaction, category) — columns, types, " +
      "enums, and the key conventions (amounts are positive minor units; direction is the `type` " +
      "column). Optionally pass `table` to get just one table's columns (keeps context small). Call " +
      "this before writing a query with `run_sql` so your SQL is correct.",
    schema: z.object({
      table: z
        .enum(["transaction", "category"])
        .optional()
        .describe("Limit the result to a single table; omit to get all finance tables"),
    }),
  },
);

export const runSql = tool(
  async (input) => {
    const verdict = validateSelect(input.query);
    if (!verdict.ok) {
      return JSON.stringify({ error: verdict.reason });
    }
    const bounded = enforceLimit(input.query, MAX_SQL_ROWS);
    try {
      const result = await runReadOnlyQuery(bounded, MAX_SQL_ROWS);
      return JSON.stringify(result);
    } catch (err) {
      // Surface the DB error text (e.g. unknown column) so the agent can fix its query.
      const message = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ error: `Query failed: ${message}` });
    }
  },
  {
    name: "run_sql",
    description:
      "Run a single READ-ONLY SQL SELECT against the finance tables and get bounded results. Use " +
      "this for aggregate/analytical questions (totals, top-N, group-by, per-month) that " +
      "`query_transactions` can't answer. Rules: SELECT only (no INSERT/UPDATE/DELETE/DDL — they " +
      "are rejected and cannot run anyway); one statement; results are capped at " +
      `${MAX_SQL_ROWS} rows. Amounts are POSITIVE MINOR UNITS (÷100 for display). Call ` +
      "`describe_finance_schema` first to get columns and conventions. JOIN category for names.",
    schema: z.object({
      query: z
        .string()
        .min(1)
        .describe("A single read-only SQL SELECT statement over the transaction/category tables"),
    }),
  },
);

/** Analytics tools, registered into the agent in agent/index.ts. Read-only (not gated). */
export const analyticsTools = [describeFinanceSchema, runSql];
