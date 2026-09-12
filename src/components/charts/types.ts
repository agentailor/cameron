/**
 * The payload a chart renders from.
 *
 * A ZERO-IMPORT leaf: the client renderer and the server tool both name this shape, and the
 * renderer must not drag anything server-side into the browser bundle.
 *
 * This is the FROZEN snapshot. `rows` are the numbers as they were when the chart was made — a
 * chart in a thread is a record of what was said, so reopening a month later must not re-query and
 * silently restate history with today's data.
 */

/** The two forms we render. See docs — pie and table are deliberate omissions, not gaps. */
export type ChartType = "bar" | "line";

export interface ChartSpec {
  chartType: ChartType;
  /** Column holding the category (bar) or the time step (line). */
  x: string;
  /** Column holding the measure. */
  y: string;
  /** Optional column that splits the measure into multiple series. */
  series?: string;
  title?: string;
  /** Rendered under the title — units, filters applied, whatever the reader needs. */
  subtitle?: string;
}

export type ChartRow = Record<string, unknown>;

export interface ChartPayload {
  spec: ChartSpec;
  columns: string[];
  rows: ChartRow[];
  /** ISO timestamp — a chart is a snapshot, and a snapshot says when. */
  generatedAt: string;
}

/** Categorical slots, in FIXED order. Never cycle, never reorder: the order is the CVD-safety
 *  mechanism (validated adjacent-pair separation), not a style choice. */
export const SERIES_SLOTS = 8;

/** Resolve a series index to its CSS custom property. Past the 8th slot, callers fold to "Other"
 *  rather than inventing a hue. */
export function seriesColor(index: number): string {
  return `var(--chart-${(index % SERIES_SLOTS) + 1})`;
}
