import { describe, expect, it } from "vitest";
import { buildModel, ticks, yScale } from "./geometry";
import type { ChartPayload } from "./types";

/**
 * The renderer is a pure function of its payload, so the decisions worth testing are the ones a
 * screenshot can't check: scale domains, gap handling, and the degenerate inputs (empty, flat,
 * single point) that otherwise divide by zero or draw nothing.
 */

function payload(
  chartType: "bar" | "line",
  rows: Record<string, unknown>[],
  series?: string,
): ChartPayload {
  return {
    spec: { chartType, x: "x", y: "y", series },
    columns: series ? ["x", "y", series] : ["x", "y"],
    rows,
    generatedAt: "2026-09-12T00:00:00.000Z",
  };
}

describe("buildModel", () => {
  it("keeps categories in first-seen order rather than sorting them", () => {
    const m = buildModel(
      payload("bar", [
        { x: "Zebra", y: 1 },
        { x: "Apple", y: 2 },
      ]),
    );
    expect(m.categories).toEqual(["Zebra", "Apple"]);
  });

  it("splits rows into one series per series-column value", () => {
    const m = buildModel(
      payload(
        "line",
        [
          { x: "Jan", y: 1, k: "A" },
          { x: "Jan", y: 2, k: "B" },
          { x: "Feb", y: 3, k: "A" },
        ],
        "k",
      ),
    );
    expect(m.series.map((s) => s.key)).toEqual(["A", "B"]);
    expect(m.categories).toEqual(["Jan", "Feb"]);
  });

  /** Every series spans every category, so a missing combination is a visible gap. */
  it("fills a missing combination with null rather than shortening the series", () => {
    const m = buildModel(
      payload(
        "line",
        [
          { x: "Jan", y: 1, k: "A" },
          { x: "Feb", y: 2, k: "B" },
        ],
        "k",
      ),
    );
    expect(m.series[0].points).toEqual([
      { x: "Jan", y: 1 },
      { x: "Feb", y: null },
    ]);
  });

  /**
   * A bar encodes magnitude by LENGTH, so a baseline that isn't zero overstates differences —
   * the most common way a chart lies. Lines may float, since they encode change.
   */
  it("anchors a bar domain to zero", () => {
    const m = buildModel(
      payload("bar", [
        { x: "a", y: 100 },
        { x: "b", y: 120 },
      ]),
    );
    expect(m.yMin).toBe(0);
  });

  it("lets a line domain float off zero", () => {
    const m = buildModel(
      payload("line", [
        { x: "a", y: 100 },
        { x: "b", y: 120 },
      ]),
    );
    expect(m.yMin).toBe(100);
  });

  it("extends a bar domain below zero when values are negative", () => {
    const m = buildModel(
      payload("bar", [
        { x: "a", y: -50 },
        { x: "b", y: 80 },
      ]),
    );
    expect(m.yMin).toBe(-50);
    expect(m.yMax).toBe(80);
  });

  it("treats non-numeric and missing values as gaps", () => {
    const m = buildModel(
      payload("line", [
        { x: "a", y: "oops" },
        { x: "b", y: null },
        { x: "c", y: 5 },
      ]),
    );
    expect(m.series[0].points.map((p) => p.y)).toEqual([null, null, 5]);
  });

  it("reports an empty payload rather than producing a zero-width scale", () => {
    expect(buildModel(payload("bar", [])).isEmpty).toBe(true);
  });

  it("reports all-null values as empty", () => {
    expect(buildModel(payload("line", [{ x: "a", y: null }])).isEmpty).toBe(true);
  });

  /** A flat series would otherwise collapse the plot to zero height. */
  it("widens a flat domain so the plot has height", () => {
    const m = buildModel(
      payload("line", [
        { x: "a", y: 7 },
        { x: "b", y: 7 },
      ]),
    );
    expect(m.yMax).toBeGreaterThan(m.yMin);
  });

  it("handles a single data point", () => {
    const m = buildModel(payload("bar", [{ x: "only", y: 5 }]));
    expect(m.isEmpty).toBe(false);
    expect(m.categories).toEqual(["only"]);
  });
});

describe("yScale", () => {
  it("maps the domain top-down, so the max sits at the top", () => {
    const m = buildModel(
      payload("bar", [
        { x: "a", y: 0 },
        { x: "b", y: 100 },
      ]),
    );
    expect(yScale(100, m, 200)).toBe(0);
    expect(yScale(0, m, 200)).toBe(200);
  });
});

describe("ticks", () => {
  it("produces round numbers covering the domain", () => {
    const m = buildModel(
      payload("bar", [
        { x: "a", y: 0 },
        { x: "b", y: 100 },
      ]),
    );
    const t = ticks(m);
    expect(t[0]).toBeLessThanOrEqual(m.yMin);
    expect(t.at(-1)!).toBeGreaterThanOrEqual(m.yMax - 1e-9);
    expect(t.every((n) => Number.isFinite(n))).toBe(true);
  });

  /** Without a zero tick a reader can't see which side of zero a bar falls on. */
  it("includes zero when the domain crosses it", () => {
    const m = buildModel(
      payload("bar", [
        { x: "a", y: -50 },
        { x: "b", y: 80 },
      ]),
    );
    expect(ticks(m)).toContain(0);
  });

  it("stays finite on a flat domain", () => {
    const m = buildModel(
      payload("line", [
        { x: "a", y: 7 },
        { x: "b", y: 7 },
      ]),
    );
    expect(ticks(m).length).toBeGreaterThan(0);
  });
});
