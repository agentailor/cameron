import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { runReadOnlyQuery } from "@/lib/repositories/analyticsRepository";
import { enforceLimit, MAX_SQL_ROWS, validateSelect } from "@/lib/finance/sqlGuard";
import type { ChartPayload, ChartType } from "@/components/charts/types";

/**
 * `render_chart` — runs an agent-authored SELECT and returns a chart for the client to draw.
 *
 * Returns a two-part result (`content_and_artifact`): `content` is a short receipt for the model,
 * `artifact` is the resolved rows for the renderer. The agent never sees row data.
 */

/** Cap chart rows well below the SQL cap: past this a chart is unreadable, not just large. */
export const MAX_CHART_ROWS = 60;

const CHART_TYPES = ["bar", "line"] as const;

function fail(error: string, extra: Record<string, unknown> = {}) {
  // A failed render returns content only — there is nothing for the client to draw.
  return [JSON.stringify({ ok: false, error, ...extra }), null] as const;
}

export const renderChart = tool(
  async (input) => {
    const verdict = validateSelect(input.query);
    if (!verdict.ok) return fail(verdict.reason);

    let result;
    try {
      result = await runReadOnlyQuery(enforceLimit(input.query, MAX_SQL_ROWS), MAX_SQL_ROWS);
    } catch (err) {
      // Surface the DB error (e.g. unknown column) so the agent can fix its own SQL.
      return fail(`Query failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (result.rowCount === 0) {
      return fail(
        "The query returned no rows, so there is nothing to chart. This does NOT confirm the " +
          "filtered values exist — a misspelled category name returns an empty result too. Check " +
          "the spelling (e.g. `list_categories`) before telling the user they have no such data.",
      );
    }

    // Fail loud on a column the query doesn't produce, naming the real ones. The agent writes both
    // the SQL and the encoding, so naming a column its own query didn't select is the likely slip
    // — and a chart drawn from undefined values would render as empty bars rather than an error.
    const wanted = [
      ["x", input.x],
      ["y", input.y],
      ...(input.series ? [["series", input.series]] : []),
    ] as [string, string][];
    const missing = wanted.filter(([, col]) => !result.columns.includes(col));
    if (missing.length > 0) {
      return fail(
        `${missing.map(([f, c]) => `\`${f}\` refers to "${c}"`).join(", ")}, which the query does ` +
          "not return. Nothing was rendered. Use one of `availableColumns`, or change the SELECT " +
          "to produce that column (alias it if it is computed).",
        { availableColumns: result.columns },
      );
    }

    // A chart built from a capped result would misstate the total while looking complete — the
    // reader cannot see that rows are missing. Refuse rather than draw a lie.
    if (result.truncated || result.rowCount > MAX_CHART_ROWS) {
      return fail(
        `The query returned ${result.truncated ? `more than ${MAX_SQL_ROWS}` : result.rowCount} ` +
          `rows; a chart takes at most ${MAX_CHART_ROWS}. A chart of a partial result looks ` +
          "complete and misstates the total, so nothing was rendered. Aggregate further " +
          "(GROUP BY), filter to a narrower period, or take a top-N with ORDER BY + LIMIT.",
      );
    }

    const payload: ChartPayload = {
      spec: {
        chartType: input.chartType as ChartType,
        x: input.x,
        y: input.y,
        ...(input.series ? { series: input.series } : {}),
        ...(input.title ? { title: input.title } : {}),
        ...(input.subtitle ? { subtitle: input.subtitle } : {}),
      },
      columns: result.columns,
      rows: result.rows,
      generatedAt: new Date().toISOString(),
    };

    // Content stays a receipt no matter how large the artifact is.
    const content = JSON.stringify({
      ok: true,
      chartType: input.chartType,
      points: result.rowCount,
      x: input.x,
      y: input.y,
      ...(input.series ? { series: input.series } : {}),
    });

    return [content, payload] as const;
  },
  {
    name: "render_chart",
    description:
      "Draw a chart from a read-only SQL SELECT and show it to the user. Read-only — runs without " +
      "approval. You supply the query and how to encode it; the chart is rendered for the user " +
      "and you get back only a short confirmation, NOT the rows — so do not call this to see " +
      "data (use `run_sql` for that) and do not describe values you have not read. Pick " +
      "`chartType` by the question: `line` when the x-axis is time (a trend), `bar` when it is " +
      "categories (a comparison). `x`, `y` and `series` must name columns your SELECT actually " +
      "returns — alias computed columns (e.g. `SUM(amount_minor) AS total`). Aggregate in SQL: at " +
      `most ${MAX_CHART_ROWS} rows can be charted. Not every answer needs a chart — a single ` +
      "figure is a sentence and a short ranking is better read as a table from `run_sql`.",
    schema: z.object({
      query: z
        .string()
        .min(1)
        .describe(
          "A single read-only SQL SELECT producing one row per point, already aggregated " +
            "(e.g. SELECT c.name AS category, SUM(t.amount_minor) AS total ... GROUP BY c.name)",
        ),
      chartType: z
        .enum(CHART_TYPES)
        .describe("'line' for a measure over time, 'bar' for a comparison across categories"),
      x: z.string().min(1).describe("Column for the category or time step, e.g. 'category'"),
      y: z.string().min(1).describe("Column holding the measure to plot, e.g. 'total'"),
      series: z
        .string()
        .min(1)
        .optional()
        .describe("Optional column that splits the measure into multiple lines/bars"),
      title: z.string().optional().describe("Short chart title, e.g. 'Spending by category'"),
      subtitle: z
        .string()
        .optional()
        .describe("Optional line under the title — units or the period covered"),
    }),
    // Splits the return tuple: content reaches the model, artifact reaches the client only.
    responseFormat: "content_and_artifact",
  },
);

/** Chart tools, registered into the agent in agent/index.ts. Read-only — not gated. */
export const chartTools = [renderChart];
