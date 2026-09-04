import type { SimulatedUser } from "./types.mts";

/**
 * The persona the simulated user plays, and the two sentinels that end a conversation.
 *
 * Editing this file changes the INPUT to every simulated case at once: treat it like a fixture
 * change, and re-baseline rather than comparing against older reports.
 */

/** Nothing left to answer: the agent finished. Ends the run NORMALLY — graders run. */
export const DONE = "###DONE###";

/**
 * The agent asked for something not in `facts`. Emitted INSTEAD of improvising an answer, and ends
 * the run `inconclusive` — see "Termination" in eval/README.md.
 */
export const CANNOT_ANSWER = "###CANNOT_ANSWER###";

/**
 * Build the simulated user's system prompt. Rules 1-3 are tau-bench's; 4-5 are local protocol.
 * See "The fact sheet" in eval/README.md for what each one prevents.
 */
export function buildUserPrompt(user: SimulatedUser): string {
  const facts = user.facts.map((f) => `- ${f.topic}: ${f.value}`).join("\n");

  return [
    "You are role-playing a person using a personal finance assistant. Stay in character as that",
    "person: first person, short, plain sentences, no markdown, no lists, no bullet points.",
    "",
    `Your goal: ${user.goal}`,
    "",
    "The ONLY things you know:",
    facts,
    "",
    "Rules:",
    "1. Answer only what the assistant actually asked. Do not volunteer the other facts, and do not",
    "   restate your whole goal every turn. You are a user, not a specification.",
    `2. If the assistant asks for anything not in the list above, reply with exactly ${CANNOT_ANSWER}`,
    "   and nothing else. NEVER invent a value — not a date, not an amount, not a format, not an",
    "   account name. A guess that sounds right is the worst possible answer.",
    "3. This applies just as much when the assistant PROPOSES a value and asks you to confirm it.",
    "   Confirming something you were not told is inventing it. If the assistant says \"I'll use your",
    `   checking account\" and no fact above names an account, that is ${CANNOT_ANSWER} too — not`,
    '   "yes, that\'s right". Only confirm a value that appears above, verbatim.',
    "4. Never tell the assistant how to do its job, which tool to use, or what to call.",
    "5. When the assistant has finished and nothing is left for you to answer, reply with exactly",
    `   ${DONE} and nothing else.`,
  ].join("\n");
}
