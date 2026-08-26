import { RUN_POLICY } from "../config.mts";
import {
  sqlMatches,
  statesAmount,
  statesNoWrongTotal,
  toolCalled,
  toolNotCalled,
} from "../graders.mts";
import { FIXTURE } from "../seed.mts";
import type { EvalCase } from "../types.mts";

/**
 * Tool selection: the `query_transactions` vs `run_sql` boundary.
 *
 * A unit test can prove each tool's payload is correct, but not that the agent PICKS the right one
 * — that needs a model in the loop. Both directions are covered on purpose: a prompt edit that
 * fixes "always aggregate in SQL" can just as easily break "list five rows", and a suite that only
 * pushes one way would stay green while the other regressed.
 */

const { dining } = FIXTURE;
const top = FIXTURE.categoriesBySpend[0];

export const cases: EvalCase[] = [
  {
    id: "total-via-sql-aggregate",
    description: "A plain total question should aggregate in SQL, not sum rows by hand.",
    prompt: `How much did I spend on ${dining.category} in total?`,
    graders: [
      toolCalled("run_sql"),
      sqlMatches(/sum\s*\(/i),
      statesAmount(dining.totalMajor),
      statesNoWrongTotal(dining.totalMajor),
    ],
    runs: RUN_POLICY.single,
    tags: ["tool-selection", "analysis"],
  },
  {
    id: "top-categories-ranking",
    description: "A ranking question should GROUP BY in SQL, not page through transactions.",
    prompt: "What are my biggest spending categories?",
    graders: [
      toolCalled("run_sql"),
      sqlMatches(/group\s+by/i),
      // The positive half: getting the ranking right means stating the top category's real total.
      statesAmount(top.totalMajor),
      toolNotCalled("query_transactions"),
    ],
    runs: RUN_POLICY.single,
    tags: ["tool-selection", "analysis"],
  },
  {
    id: "listing-uses-query-transactions",
    description:
      "The inverse guard: a LISTING request must use query_transactions, not SQL. Stops a fix to " +
      "the aggregate cases from over-rotating the prompt into 'always use run_sql'.",
    prompt: `Show me my 5 most recent ${dining.category} transactions.`,
    graders: [toolCalled("query_transactions"), toolNotCalled("run_sql")],
    runs: RUN_POLICY.single,
    tags: ["tool-selection", "over-triggering-guard"],
  },
];
