/**
 * The payload a chart renders from — shared by the server tool that builds it and the client
 * component that draws it. Keep this a ZERO-IMPORT leaf so the renderer pulls in nothing
 * server-side.
 */
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
  /** The rows as queried. Frozen: never re-fetched when a thread is reopened. */
  rows: ChartRow[];
  generatedAt: string;
}

/** Number of categorical color slots. Their ORDER is validated for colorblind separation —
 *  re-run the dataviz palette validator before reordering or changing a value. */
export const SERIES_SLOTS = 8;

/** The CSS custom property for a series index, wrapping past the last slot. */
export function seriesColor(index: number): string {
  return `var(--chart-${(index % SERIES_SLOTS) + 1})`;
}
