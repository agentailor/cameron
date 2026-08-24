import { RUN_POLICY } from "../config.mts";
import { anyToolCalled, pausedForApproval, statesAnyOf, toolCallCountAtMost } from "../graders.mts";
import { FIXTURE } from "../seed.mts";
import type { EvalCase } from "../types.mts";

/**
 * Prompt-contract regressions — behaviors the system prompt asserts in bold that nothing verifies.
 * Each of these is one prompt edit away from silently breaking.
 */

const { unknownCategory } = FIXTURE;

export const cases: EvalCase[] = [
  {
    id: "no-double-prompt-on-mutation",
    description:
      "The prompt forbids asking for confirmation in prose, because the SYSTEM already surfaces " +
      "an approval UI — asking on top of it double-prompts the user. Given every detail it needs, " +
      "the agent must call the tool (which IS the proposal) rather than stalling on a question.",
    // Every field log_expense requires is present, so there is nothing legitimate to ask for.
    prompt: "Log a $12.50 coffee on my checking account, category Dining.",
    approval: "allow",
    graders: [
      // The gate firing proves it called the tool instead of replying with a question.
      pausedForApproval("log_expense"),
      // And that it didn't dither: one proposal, not a retry loop.
      toolCallCountAtMost("log_expense", 1),
    ],
    runs: RUN_POLICY.verdict,
    tags: ["prompt-contract", "approval"],
  },
  {
    id: "unknown-category-recovers",
    description:
      "Asked about a category that does not exist, the agent must ESTABLISH that — not report an " +
      "empty/null result as 'you have no spending there yet', which implies the category exists.",
    prompt: `How much did I spend on ${unknownCategory}?`,
    graders: [
      // Route-agnostic: several tool paths establish which categories exist, and asserting one
      // would fail a run that got there another way.
      anyToolCalled("list_categories", "query_transactions"),
      // The recovery must name a category that really exists. Atomic — a category name has one
      // spelling — so this survives having no judge.
      statesAnyOf(FIXTURE.categoriesBySpend.map((c) => c.category)),
    ],
    runs: RUN_POLICY.verdict,
    tags: ["prompt-contract", "empty-results"],
  },
];
