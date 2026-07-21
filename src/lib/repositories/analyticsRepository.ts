import { sql } from "drizzle-orm";
import db from "@/lib/database/db";
import { MAX_SQL_ROWS } from "@/lib/finance/sqlGuard";

/**
 * The one sanctioned place that runs raw, agent-authored SQL (for the `run_sql` tool). The real
 * write-guard lives here, not in the regex validator: every query runs inside a Drizzle transaction
 * marked `READ ONLY` + `statement_timeout` and is always rolled back, so Postgres itself rejects any
 * write (SQLSTATE 25006) even if a payload slips past `sqlGuard.validateSelect`. Rows are hard-capped.
 */

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

const STATEMENT_TIMEOUT_MS = 3000;

// Thrown after capturing rows to force the read-only transaction to roll back.
const ROLLBACK_SIGNAL = "__analytics_readonly_rollback__";

/**
 * Execute a validated read-only SELECT and return bounded results. Callers MUST pass SQL that has
 * already been through {@link import("@/lib/finance/sqlGuard").validateSelect}.
 */
export async function runReadOnlyQuery(
  query: string,
  maxRows: number = MAX_SQL_ROWS,
): Promise<QueryResult> {
  let captured: QueryResult | null = null;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set transaction read only`);
      await tx.execute(sql.raw(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`));

      const result = await tx.execute(sql.raw(query));
      const fields = (result.fields ?? []) as { name: string }[];
      const allRows = (result.rows ?? []) as Record<string, unknown>[];
      const truncated = allRows.length > maxRows;
      const rows = truncated ? allRows.slice(0, maxRows) : allRows;
      captured = { columns: fields.map((f) => f.name), rows, rowCount: rows.length, truncated };

      throw new Error(ROLLBACK_SIGNAL);
    });
  } catch (err) {
    if (!(err instanceof Error) || err.message !== ROLLBACK_SIGNAL) {
      // Real failure: Drizzle wraps the pg error as "Failed query: …" — surface the real cause.
      const cause = (err as { cause?: unknown })?.cause;
      const message =
        (cause instanceof Error && cause.message) ||
        (err instanceof Error ? err.message : String(err));
      throw new Error(message);
    }
  }

  return captured ?? { columns: [], rows: [], rowCount: 0, truncated: false };
}
