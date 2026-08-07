import { RUN_POLICY } from "./config.mts";
import { sqlMatches, statesAmount, statesNoWrongTotal, toolCalled } from "./graders.mts";
import { FIXTURE } from "./seed.mts";
import type { EvalCase } from "./types.mts";

const { totalMajor, category } = FIXTURE.dining;

export const cases: EvalCase[] = [
  {
    id: "total-via-sql-aggregate",
    description: "A plain total question should aggregate in SQL, not sum rows by hand.",
    prompt: `How much did I spend on ${category} in total?`,
    graders: [
      toolCalled("run_sql"),
      sqlMatches(/sum\s*\(/i),
      statesAmount(totalMajor),
      statesNoWrongTotal(totalMajor),
    ],
    // A total is either right or wrong — one bad run is a real defect, so require all three.
    runs: RUN_POLICY.strict,
  },
];

// TODO: a "list and total" case belongs here, but the prompt currently makes the agent render
// all 262 rows before totalling — minutes per run, and the rendering is itself the defect to fix
// (run_sql returns up to 500 raw rows with no guidance). Add the case with that fix.
