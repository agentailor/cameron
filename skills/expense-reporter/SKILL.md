---
name: expense-reporter
description: Turn spending questions into visual reports with charts. Use when the owner asks to visualize spending, see trends over time, compare categories, or get a report rather than a plain figure. Covers picking the right chart for the question and describing what the numbers show.
---

# Expense Reporter

> **Placeholder.** This skill exists so the loader, the prompt section and `load_skill` are
> exercised end to end. Its real instructions — chart selection, the query-to-chart workflow and
> the reporting voice — arrive with the reporting work in the next phase.

## Workflow

1. Establish what the owner is actually asking: a comparison between categories, a trend over
   time, a breakdown of a whole, or a single figure.
2. Get the numbers with `run_sql`, aggregating in SQL rather than summing rows by hand.
3. Report the figures plainly, leading with the number that answers the question.

## Notes

- A single figure does not need a chart. Say the number.
- Amounts are stored as positive minor units; divide by 100 for display.
