import { RUN_POLICY } from "../config.mts";
import { statesAmount, statesCount, statesNoWrongTotal, toolResultMatches } from "../graders.mts";
import { FIXTURE } from "../seed.mts";
import type { EvalCase } from "../types.mts";

/**
 * Truncation awareness — the defect class docs/TESTING.md was written around.
 *
 * A unit test proves `truncated: true` is IN the payload. It cannot prove the agent noticed it:
 * that it didn't sum a capped page and report the figure as the year's total. In a finance agent
 * that is a confidently-stated wrong number, which is the worst output this repo can produce.
 *
 * The fixture is the trap: Dining has 262 rows against a 200-row cap, so any attempt to answer by
 * listing MUST come back partial.
 */

const { dining } = FIXTURE;

export const cases: EvalCase[] = [
  {
    id: "truncated-page-not-reported-as-total",
    description:
      "Asked for a count AND a total over a set that exceeds the row cap, the agent must report " +
      "the true figures — never the capped page's 200 rows or their sum.",
    // Deliberately asks for a count + total rather than a listing. The truncation decision is the
    // same, but the agent isn't invited to render hundreds of rows into the answer (which made the
    // original version of this case take minutes per run).
    prompt: `How many ${dining.category} transactions do I have, and what do they total?`,
    graders: [
      // Positive halves — without these the negative grader below passes on a non-answer.
      statesCount(dining.count),
      statesAmount(dining.totalMajor),
      statesNoWrongTotal(dining.totalMajor),
      // If it DID page, it must have seen the truncation flag. Vacuous-passes when the agent
      // correctly went straight to run_sql — that route is a pass, not a failure.
      toolResultMatches(
        "query_transactions",
        (r) => r.truncated === true || r.matched === dining.count,
        { whenCalled: true, label: "truncated/matched" },
      ),
    ],
    // A wrong total is never acceptable at any rate.
    runs: RUN_POLICY.strict,
    tags: ["truncation", "correctness"],
  },
];
