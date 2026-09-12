---
name: expense-reporter
description: Turn spending questions into visual reports with charts. Use when the owner asks to visualize spending, see trends over time, compare categories, or get a report rather than a plain figure. Covers picking the right chart for the question and describing what the numbers show.
---

# Expense Reporter

## Step 1 — decide whether this needs a chart

Most money questions do not. A chart earns its place only when the **shape** of the data is the
point — a ranking, a trend, a comparison across several things.

The owner's words decide first. If they asked to **see, visualise, chart, plot or graph** it — or
asked for a report — draw the chart. Otherwise:

| The answer is…                     | Give them                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| One number                         | A sentence. `run_sql`, then say the figure.                                           |
| Up to ~6 rows, exact values wanted | The `run_sql` table. Numbers you can read beat bars you have to estimate.             |
| ~7 or more categories              | A **bar** chart — past a handful, the ranking is easier seen than read.               |
| A measure over time (2+ periods)   | A **line** chart. A trend is a shape, so chart it even when the rows are few.         |
| More than ~12 categories           | Top N with `ORDER BY … LIMIT`, plus "and N others". A crowded chart hides the answer. |

These bands do not overlap: pick the first row that matches. When it is still a close call, answer
in prose — an unasked-for chart is noise, while a missing one is a follow-up question, which is
cheaper.

## Step 2 — pick the type

Only two exist, and the x-axis decides:

- **`line`** — x is time (a month, a week, a date). The question is "is this changing?"
- **`bar`** — x is a category, merchant, or account. The question is "which is biggest?"

Never use a line for categories: a line between "Groceries" and "Transport" implies a progression
that isn't there.

Use `series` only when comparing a handful of things over time (2–4). Past that the chart becomes
a thicket — facet it into separate charts or narrow the question instead.

## Step 3 — write the query

One row per point, aggregated in SQL. `render_chart` charts what the query returns, so the query
does the shaping.

```sql
-- bar: spending by category
SELECT c.name AS category, SUM(t.amount_minor) / 100.0 AS total
FROM transaction t JOIN category c ON c.id = t.category_id
WHERE t.type = 'expense'
GROUP BY c.name
ORDER BY total DESC;

-- line: spending per month
SELECT to_char(t.occurred_at, 'YYYY-MM') AS month, SUM(t.amount_minor) / 100.0 AS total
FROM transaction t
WHERE t.type = 'expense'
GROUP BY month
ORDER BY month;
```

Three things that make a chart wrong rather than ugly:

- **Divide by 100 in the query.** Amounts are minor units; a chart axis reading `14672` when the
  owner spent $146.72 is simply incorrect.
- **`ORDER BY` matters.** A bar chart is read as a ranking, so sort by the measure. A line chart is
  read left-to-right as time, so sort by the time column.
- **Alias every computed column**, because `x` and `y` must name columns the query actually
  returns. `SUM(...)` without an alias is not addressable.

## Step 4 — render and read it back

Call `render_chart` with the query, `chartType`, `x`, `y`, and a `title`. It returns a
confirmation, **not the rows** — so any number you quote must come from a `run_sql` you ran.
Never describe values you have not read.

Then say what the chart shows. The chart is evidence; the sentence is the answer:

> Groceries is your largest category at **$146.72**, about a third of the $437 total. Utilities
> follows at $120.

Lead with the figure that answers the question. One or two observations is enough — the owner can
see the rest. Never moralize about the spending.

## When render_chart refuses

It returns an error instead of drawing when the result would mislead. Each one is actionable:

- **A column that isn't in the result** — it lists the real columns; fix `x`/`y` or alias the
  column in the SELECT.
- **Too many rows** — aggregate further, narrow the period, or take a top N.
- **No rows** — this does _not_ confirm the category is empty. A misspelled name returns nothing
  too. Check with `list_categories` before telling the owner they have no such spending.
