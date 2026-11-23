import { RUN_POLICY } from "../config.mts";
import { inThread, memorySaved, statesAmount, toolCalled, toolCalledBefore } from "../graders.mts";
import { FIXTURE } from "../seed.mts";
import type { EvalCase } from "../types.mts";

/**
 * Memory: preferences the owner states once and Cameron applies in later conversations.
 *
 * The defect class is a preference that never reaches the turn that needs it: saved but not read
 * in a new thread, or read but not applied. Graded on the consequence (the `memory` row, the
 * number in the answer) and on ORDER: "recall before run_sql" is what shows the preference shaped
 * the query instead of the agent happening to pick the right categories.
 */

const { dining, groceries } = FIXTURE;
/** "Food" is ambiguous without the preference: dining alone is a plausible reading. */
const foodTotal = dining.totalMajor + groceries.totalMajor;

export const cases: EvalCase[] = [
  {
    id: "memory-applies-in-new-thread",
    description:
      "A preference remembered in one thread changes the answer in the next: recalled before " +
      "the query, and the total covers both categories.",
    prompt:
      `Remember this: when I ask about "food", I mean ${dining.category} and ` +
      `${groceries.category} together.`,
    threads: [{ prompt: "How much have I spent on food in total?" }],
    config: { currency: FIXTURE.ledgerCurrency },
    graders: [
      memorySaved(/food/i),
      inThread(2, toolCalled("recall")),
      inThread(2, toolCalledBefore("recall", "run_sql")),
      inThread(2, statesAmount(foodTotal)),
    ],
    // Two model-driven decisions in a row (save, then recall unprompted) compound variance.
    runs: RUN_POLICY.majority,
    tags: ["memory"],
  },
];
