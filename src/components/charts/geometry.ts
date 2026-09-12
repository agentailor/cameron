import type { ChartPayload, ChartRow } from "./types";

/** Turns a payload into coordinates: series grouping, scale domains, ticks. Pure and DOM-free. */

export interface Series {
  key: string;
  /** null y = a genuine gap in the data; the line breaks rather than interpolating across it. */
  points: { x: string; y: number | null }[];
}

export interface ChartModel {
  series: Series[];
  /** Distinct x values, in first-seen order — categorical, never re-sorted. */
  categories: string[];
  yMin: number;
  yMax: number;
  /** True when there is nothing to draw; the component shows an empty state instead. */
  isEmpty: boolean;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toLabel(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return String(value);
}

/**
 * Group rows into series and collect the x domain.
 *
 * The y domain ALWAYS includes zero for bars: a bar encodes magnitude by length, so a truncated
 * baseline overstates differences — the most common way a chart lies. Lines may float, since they
 * encode change rather than magnitude.
 */
export function buildModel(payload: ChartPayload): ChartModel {
  const { spec, rows } = payload;
  const categories: string[] = [];
  const seen = new Set<string>();
  const bySeries = new Map<string, Map<string, number | null>>();

  for (const row of rows as ChartRow[]) {
    const x = toLabel(row[spec.x]);
    if (!seen.has(x)) {
      seen.add(x);
      categories.push(x);
    }
    const key = spec.series ? toLabel(row[spec.series]) : spec.y;
    if (!bySeries.has(key)) bySeries.set(key, new Map());
    bySeries.get(key)!.set(x, toNumber(row[spec.y]));
  }

  const series: Series[] = [...bySeries.entries()].map(([key, values]) => ({
    key,
    // Every series carries every category, so a missing combination is an explicit gap rather
    // than a silently shorter line.
    points: categories.map((x) => ({ x, y: values.has(x) ? values.get(x)! : null })),
  }));

  const numbers = series
    .flatMap((s) => s.points.map((p) => p.y))
    .filter((n): n is number => n !== null);

  const isEmpty = numbers.length === 0;
  let yMin = isEmpty ? 0 : Math.min(...numbers);
  let yMax = isEmpty ? 0 : Math.max(...numbers);

  if (payload.spec.chartType === "bar") {
    // Anchor bars to zero in whichever direction the data runs.
    yMin = Math.min(0, yMin);
    yMax = Math.max(0, yMax);
  }
  // A flat series would otherwise collapse to a zero-height plot.
  if (yMin === yMax) {
    yMax = yMin + 1;
  }

  return { series, categories, yMin, yMax, isEmpty };
}

/** Map a value to a y pixel, top-down. */
export function yScale(value: number, model: ChartModel, height: number): number {
  const span = model.yMax - model.yMin;
  return height - ((value - model.yMin) / span) * height;
}

/**
 * Nice round tick values covering the domain — at most `count`, always including the zero line
 * when the domain crosses it, so a reader can see which side of zero a mark falls.
 */
export function ticks(model: ChartModel, count = 4): number[] {
  const span = model.yMax - model.yMin;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;

  const out: number[] = [];
  for (let t = Math.ceil(model.yMin / step) * step; t <= model.yMax + 1e-9; t += step) {
    out.push(Math.abs(t) < 1e-9 ? 0 : t);
  }
  if (model.yMin < 0 && model.yMax > 0 && !out.some((t) => t === 0)) out.push(0);
  return out.sort((a, b) => a - b);
}
