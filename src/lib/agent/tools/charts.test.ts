import { beforeEach, describe, expect, it, vi } from "vitest";
import { callToolWithArtifact } from "./testing";

/**
 * Contract tests for render_chart — repository stubbed. See docs/TESTING.md.
 *
 * Success cases assert on BOTH halves: content and artifact are different payloads, so checking
 * one leaves the other unverified.
 */

vi.mock("@/lib/repositories/analyticsRepository", () => ({ runReadOnlyQuery: vi.fn() }));

const repo = await import("@/lib/repositories/analyticsRepository");
const { renderChart, MAX_CHART_ROWS } = await import("./charts");

const ARGS = {
  query: "SELECT c.name AS category, SUM(t.amount_minor) AS total FROM transaction t GROUP BY 1",
  chartType: "bar",
  x: "category",
  y: "total",
};

function result(
  rows: Record<string, unknown>[],
  columns = ["category", "total"],
  truncated = false,
) {
  return { columns, rows, rowCount: rows.length, truncated };
}

const TWO_ROWS = [
  { category: "Dining", total: 28100 },
  { category: "Groceries", total: 42350 },
];

beforeEach(() => {
  vi.resetAllMocks();
});

describe("render_chart", () => {
  it("returns a receipt to the model and the rows to the client", async () => {
    vi.mocked(repo.runReadOnlyQuery).mockResolvedValue(result(TWO_ROWS));

    const { content, artifact } = await callToolWithArtifact(renderChart, ARGS);

    expect(content).toMatchObject({ ok: true, chartType: "bar", points: 2, x: "category" });
    expect(artifact.rows).toEqual(TWO_ROWS);
    expect(artifact.spec).toMatchObject({ chartType: "bar", x: "category", y: "total" });
    expect(artifact.columns).toEqual(["category", "total"]);
  });

  /**
   * The whole reason this tool exists. If rows leaked into content the agent would pay for data it
   * never reads, which is the cost the artifact split removes.
   */
  it("keeps row data out of the model's payload entirely", async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ category: `cat-${i}`, total: i * 100 }));
    vi.mocked(repo.runReadOnlyQuery).mockResolvedValue(result(many));

    const { content, artifact } = await callToolWithArtifact(renderChart, ARGS);

    expect(JSON.stringify(content)).not.toContain("cat-49");
    expect(JSON.stringify(content).length).toBeLessThan(150);
    expect(artifact.rows).toHaveLength(50);
  });

  it("stamps the artifact with a generation time", async () => {
    vi.mocked(repo.runReadOnlyQuery).mockResolvedValue(result(TWO_ROWS));

    const { artifact } = await callToolWithArtifact(renderChart, ARGS);

    expect(Number.isNaN(Date.parse(artifact.generatedAt))).toBe(false);
  });

  it("carries optional series and titles into the spec", async () => {
    vi.mocked(repo.runReadOnlyQuery).mockResolvedValue(
      result(
        [{ month: "2026-07", total: 100, category: "Dining" }],
        ["month", "total", "category"],
      ),
    );

    const { artifact } = await callToolWithArtifact(renderChart, {
      ...ARGS,
      chartType: "line",
      x: "month",
      series: "category",
      title: "Spending over time",
      subtitle: "Last 3 months",
    });

    expect(artifact.spec).toMatchObject({
      chartType: "line",
      series: "category",
      title: "Spending over time",
      subtitle: "Last 3 months",
    });
  });

  it("omits absent optional fields rather than setting them undefined", async () => {
    vi.mocked(repo.runReadOnlyQuery).mockResolvedValue(result(TWO_ROWS));

    const { artifact } = await callToolWithArtifact(renderChart, ARGS);

    expect("series" in artifact.spec).toBe(false);
    expect("title" in artifact.spec).toBe(false);
  });
});

describe("render_chart failures", () => {
  /**
   * The agent writes both the SQL and the encoding, so naming a column its own query didn't
   * select is the likely slip. Undefined values would draw as empty bars — a chart that looks
   * fine and shows nothing — so this must fail loudly and name the real columns.
   */
  it.each([
    ["x", { x: "categorie" }],
    ["y", { y: "amount" }],
    ["series", { series: "bucket" }],
  ])("rejects a %s column the query does not return", async (_label, override) => {
    vi.mocked(repo.runReadOnlyQuery).mockResolvedValue(result(TWO_ROWS));

    const { content, artifact } = await callToolWithArtifact(renderChart, { ...ARGS, ...override });

    expect(content.ok).toBe(false);
    expect(content.availableColumns).toEqual(["category", "total"]);
    expect(artifact).toBeNull();
  });

  it("names every missing column at once, not just the first", async () => {
    vi.mocked(repo.runReadOnlyQuery).mockResolvedValue(result(TWO_ROWS));

    const { content } = await callToolWithArtifact(renderChart, {
      ...ARGS,
      x: "nope",
      y: "alsonope",
    });

    expect(content.error).toContain("nope");
    expect(content.error).toContain("alsonope");
  });

  /**
   * A chart of a capped result looks complete — the reader cannot see the missing rows — so it
   * misstates the total. Refuse rather than draw a lie. This is the same defect class as the
   * truncation bug, handled differently because a chart has no room for a caveat.
   */
  it("refuses to chart a truncated result", async () => {
    vi.mocked(repo.runReadOnlyQuery).mockResolvedValue(
      result(TWO_ROWS, ["category", "total"], true),
    );

    const { content, artifact } = await callToolWithArtifact(renderChart, ARGS);

    expect(content.ok).toBe(false);
    expect(content.error).toMatch(/partial|complete/i);
    expect(artifact).toBeNull();
  });

  it("refuses more rows than a chart can show", async () => {
    const many = Array.from({ length: MAX_CHART_ROWS + 1 }, (_, i) => ({
      category: `cat-${i}`,
      total: i,
    }));
    vi.mocked(repo.runReadOnlyQuery).mockResolvedValue(result(many));

    const { content } = await callToolWithArtifact(renderChart, ARGS);

    expect(content.ok).toBe(false);
    expect(content.error).toContain(String(MAX_CHART_ROWS));
  });

  it("accepts exactly the maximum", async () => {
    const many = Array.from({ length: MAX_CHART_ROWS }, (_, i) => ({
      category: `cat-${i}`,
      total: i,
    }));
    vi.mocked(repo.runReadOnlyQuery).mockResolvedValue(result(many));

    const { content } = await callToolWithArtifact(renderChart, ARGS);

    expect(content.ok).toBe(true);
  });

  /** An empty result is byte-identical whether the category exists or is misspelled. */
  it("warns that an empty result may be a misspelling, not missing data", async () => {
    vi.mocked(repo.runReadOnlyQuery).mockResolvedValue(result([]));

    const { content, artifact } = await callToolWithArtifact(renderChart, ARGS);

    expect(content.ok).toBe(false);
    expect(content.error).toMatch(/spelling/i);
    expect(artifact).toBeNull();
  });

  it("rejects a non-SELECT before touching the database", async () => {
    const { content } = await callToolWithArtifact(renderChart, {
      ...ARGS,
      query: "DELETE FROM transaction",
    });

    expect(content.ok).toBe(false);
    expect(repo.runReadOnlyQuery).not.toHaveBeenCalled();
  });

  it("surfaces the database error so the agent can fix its query", async () => {
    vi.mocked(repo.runReadOnlyQuery).mockRejectedValue(new Error('column "bogus" does not exist'));

    const { content } = await callToolWithArtifact(renderChart, ARGS);

    expect(content.ok).toBe(false);
    expect(content.error).toContain("bogus");
  });
});
