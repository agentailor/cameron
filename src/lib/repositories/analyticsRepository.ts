import { sql } from "drizzle-orm";
import db from "@/lib/database/db";
import { MAX_SQL_ROWS, QueryError } from "@/lib/finance/sqlGuard";

/**
 * The one sanctioned place that runs raw, agent-authored SQL (for the `run_sql` tool). The real
 * guards live here, not in the regex validator. Every query runs inside a Drizzle transaction that
 * is `READ ONLY` (Postgres rejects writes, SQLSTATE 25006), has a `statement_timeout`, runs as the
 * `cameron_analytics` role (SELECT on the finance tables only — anything else is SQLSTATE 42501,
 * see drizzle/0006_analytics_readonly_role.sql), and is always rolled back. Rows are hard-capped.
 */

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

const STATEMENT_TIMEOUT_MS = 3000;

/** Created by migration 0006. Its grants, not this code, decide which tables `run_sql` can read. */
const ANALYTICS_ROLE = "cameron_analytics";

// Thrown after capturing rows to force the read-only transaction to roll back.
const ROLLBACK_SIGNAL = "__analytics_readonly_rollback__";

/**
 * Execute a validated read-only SELECT and return bounded results. Callers MUST pass SQL that has
 * already been through {@link import("@/lib/finance/sqlGuard").validateSelect}. Database failures
 * throw a {@link QueryError} carrying the SQLSTATE.
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
      await tx.execute(sql.raw(`set local role ${ANALYTICS_ROLE}`));

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
      // Drizzle wraps the pg error as "Failed query: …" — surface the real cause and its SQLSTATE.
      const cause = (err as { cause?: unknown })?.cause;
      const message =
        (cause instanceof Error && cause.message) ||
        (err instanceof Error ? err.message : String(err));
      const code = (cause as { code?: unknown })?.code ?? (err as { code?: unknown })?.code;
      throw new QueryError(message, typeof code === "string" ? code : undefined);
    }
  }

  return captured ?? { columns: [], rows: [], rowCount: 0, truncated: false };
}
