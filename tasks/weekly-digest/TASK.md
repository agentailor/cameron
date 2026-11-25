---
name: weekly-digest
description: Every Monday morning, a short summary of last week's spending against the week before.
schedule: "0 8 * * MON"
---

Write a short digest of last week's spending (Monday to Sunday, ending yesterday).

1. Read the owner's currency with `get_config`. If it isn't set, say so and stop.
2. With `run_sql`, get last week's total spending and its top five categories, and the same
   figures for the week before.
3. List any single expense from last week that is more than three times that category's
   average expense over the previous eight weeks.

Report the two totals and the change between them, the top categories with their amounts, and
the unusual expenses, if any. If last week has no transactions, say so plainly: don't compare
against an empty week. Only read: this digest changes nothing in the records.
