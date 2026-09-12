import { Chart } from "@/components/charts/Chart";
import type { ChartPayload } from "@/components/charts/types";

/**
 * Development surface for eyeballing the chart renderer.
 *
 * The palette validator checks color; it cannot check layout. Label collisions, overflow and
 * geometry are eyeball-only, so every case below is one that has historically broken a chart:
 * too many categories, long labels, a dominant outlier, negatives, one point, none.
 *
 * Not linked from the app's navigation — open /dev/charts directly.
 */

export const metadata = { title: "Charts · dev" };

const AT = "2026-09-12T10:00:00.000Z";

function payload(
  title: string,
  subtitle: string,
  chartType: "bar" | "line",
  x: string,
  y: string,
  rows: Record<string, unknown>[],
  series?: string,
): ChartPayload {
  return {
    spec: { chartType, x, y, series, title, subtitle },
    columns: series ? [x, y, series] : [x, y],
    rows,
    generatedAt: AT,
  };
}

const CASES: ChartPayload[] = [
  payload(
    "Spending by category",
    "Three categories — the common case",
    "bar",
    "category",
    "total",
    [
      { category: "Groceries", total: 42350 },
      { category: "Dining", total: 28100 },
      { category: "Transport", total: 15400 },
    ],
  ),

  payload(
    "Spending by category",
    "Twelve categories — x labels must thin, not collide",
    "bar",
    "category",
    "total",
    [
      { category: "Groceries", total: 42350 },
      { category: "Dining", total: 28100 },
      { category: "Transport", total: 15400 },
      { category: "Utilities", total: 13200 },
      { category: "Rent", total: 98000 },
      { category: "Health", total: 7600 },
      { category: "Shopping", total: 22400 },
      { category: "Travel", total: 31000 },
      { category: "Subscriptions", total: 4300 },
      { category: "Fitness", total: 5200 },
      { category: "Gifts", total: 3100 },
      { category: "Misc", total: 2800 },
    ],
  ),

  payload(
    "Spending by category",
    "Long labels — the classic overflow case",
    "bar",
    "category",
    "total",
    [
      { category: "Household supplies and cleaning", total: 12350 },
      { category: "Restaurants, cafés and takeaway", total: 28100 },
      { category: "Public transport and taxis", total: 15400 },
      { category: "Streaming and subscriptions", total: 4300 },
    ],
  ),

  payload(
    "Spending by category",
    "One dominant outlier flattens the rest",
    "bar",
    "category",
    "total",
    [
      { category: "Rent", total: 980000 },
      { category: "Groceries", total: 42350 },
      { category: "Dining", total: 28100 },
      { category: "Transport", total: 15400 },
    ],
  ),

  payload("Monthly spending", "Twelve months — a trend", "line", "month", "total", [
    { month: "2026-01", total: 210400 },
    { month: "2026-02", total: 198300 },
    { month: "2026-03", total: 224100 },
    { month: "2026-04", total: 231800 },
    { month: "2026-05", total: 205600 },
    { month: "2026-06", total: 248900 },
    { month: "2026-07", total: 262300 },
    { month: "2026-08", total: 239700 },
    { month: "2026-09", total: 251200 },
    { month: "2026-10", total: 268400 },
    { month: "2026-11", total: 244800 },
    { month: "2026-12", total: 289100 },
  ]),

  payload("Monthly spending", "Only three points", "line", "month", "total", [
    { month: "2026-07", total: 262300 },
    { month: "2026-08", total: 239700 },
    { month: "2026-09", total: 251200 },
  ]),

  payload(
    "Monthly spending",
    "A gap — the line must break, not interpolate",
    "line",
    "month",
    "total",
    // Flat-ish either side of the hole: a steep segment reads like a rendering artifact rather
    // than data, which defeats the point of the case.
    [
      { month: "2026-01", total: 210400 },
      { month: "2026-02", total: 214800 },
      { month: "2026-03", total: null },
      { month: "2026-04", total: 231800 },
      { month: "2026-05", total: 228600 },
      { month: "2026-06", total: 236100 },
    ],
  ),

  payload("Income vs expense", "Negatives — bars cross a zero line", "bar", "month", "net", [
    { month: "2026-05", net: 42000 },
    { month: "2026-06", net: -18300 },
    { month: "2026-07", net: 31500 },
    { month: "2026-08", net: -7400 },
    { month: "2026-09", net: 22800 },
  ]),

  payload(
    "Spending by category over time",
    "Multiple series — legend required",
    "line",
    "month",
    "total",
    [
      { month: "2026-07", total: 42350, category: "Groceries" },
      { month: "2026-08", total: 45100, category: "Groceries" },
      { month: "2026-09", total: 41200, category: "Groceries" },
      { month: "2026-07", total: 28100, category: "Dining" },
      { month: "2026-08", total: 31400, category: "Dining" },
      { month: "2026-09", total: 26800, category: "Dining" },
      { month: "2026-07", total: 15400, category: "Transport" },
      { month: "2026-08", total: 14200, category: "Transport" },
      { month: "2026-09", total: 16100, category: "Transport" },
    ],
    "category",
  ),

  payload("Spending by category", "A single data point", "bar", "category", "total", [
    { category: "Groceries", total: 42350 },
  ]),

  payload(
    "Spending by category",
    "Empty result — must not render axes",
    "bar",
    "category",
    "total",
    [],
  ),
];

export default function DevChartsPage() {
  return (
    <div className="bg-muted/40 min-h-screen overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-foreground text-2xl font-semibold">Chart renderer</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Every case the renderer has to survive, drawn from hardcoded payloads. Toggle your system
          theme to check dark mode — the dark series colors are stepped for the dark ground, not
          flipped. Hover a chart to check the tooltip.
        </p>

        <div className="mt-10 space-y-10">
          {CASES.map((c, i) => (
            <section key={i}>
              <Chart payload={c} />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
