import { anyToolCalled, statesAmount, statesAnyOf, toolCalled } from "../graders.mts";
import { FIXTURE } from "../seed.mts";
import type { Grader } from "../types.mts";
import { BENCH_FIXTURE as B } from "./servers.mts";

/**
 * The benchmark's tasks. Every answer lives in a CORE server or in Cameron's own ledger, so a task
 * runs unchanged at every scale and only the number of distractors moves.
 */

export type TaskGroup = "plain" | "paraphrase" | "confusable" | "two-server" | "ledger" | "thread";

export interface BenchTask {
  id: string;
  group: TaskGroup;
  /** User messages, sent in order on one thread. */
  turns: string[];
  /** The right tools were used. */
  tools: Grader[];
  /** The final answer states the right thing. */
  answer: Grader[];
  /** Run only at this scale (the long conversation). */
  onlyAtScale?: number;
}

const { dining, groceries } = FIXTURE;
const top = FIXTURE.categoriesBySpend[0];
const iban = [B.savingsIban, B.savingsIban.replace(/\s/g, "")];

/** Scale the five-turn conversation runs at. */
export const THREAD_SCALE = Number(process.env.BENCH_THREAD_SCALE ?? 10);

export const tasks: BenchTask[] = [
  {
    id: "bank-balance",
    group: "plain",
    turns: ["What's the current balance of my checking account at my bank?"],
    tools: [toolCalled("bank_get_account_balance")],
    answer: [statesAmount(B.checkingBalance)],
  },
  {
    id: "bank-iban",
    group: "plain",
    turns: ["What's the IBAN of my savings account?"],
    tools: [toolCalled("bank_get_iban")],
    answer: [statesAnyOf(iban)],
  },
  {
    id: "notes-notebooks",
    group: "plain",
    turns: ["Which notebooks do I have in my notes?"],
    tools: [toolCalled("notes_list_notebooks")],
    answer: [statesAnyOf([B.notebook])],
  },
  {
    id: "calendar-next",
    group: "plain",
    turns: ["What's the next event on my calendar?"],
    tools: [toolCalled("calendar_next_event")],
    answer: [statesAnyOf([B.nextEvent])],
  },
  {
    id: "landlord-in-other-words",
    group: "paraphrase",
    turns: ["Did I write anything down about my landlord?"],
    tools: [toolCalled("notes_search_notes")],
    answer: [statesAnyOf([B.landlordRent, "1,150"])],
  },
  {
    id: "card-in-other-words",
    group: "paraphrase",
    turns: ["What have I been swiping my card on lately?"],
    tools: [toolCalled("bank_list_card_activity")],
    answer: [statesAnyOf([B.cardMerchant])],
  },
  {
    // From scale 4 up, other servers have a search tool too.
    id: "boiler-search",
    group: "confusable",
    turns: ["Search for what I wrote about the boiler."],
    tools: [anyToolCalled("notes_search_notes", "notes_read_note")],
    answer: [statesAnyOf([B.boilerDate, "April 14"])],
  },
  {
    id: "balance-and-landlord",
    group: "two-server",
    turns: ["What's my checking balance, and what did I note about my landlord's rent?"],
    tools: [toolCalled("bank_get_account_balance", "notes_search_notes")],
    answer: [statesAmount(B.checkingBalance), statesAnyOf([B.landlordRent, "1,150"])],
  },
  {
    id: "event-and-accounts",
    group: "two-server",
    turns: ["What's my next calendar event, and which accounts do I have at the bank?"],
    tools: [toolCalled("calendar_next_event", "bank_list_accounts")],
    answer: [statesAnyOf([B.nextEvent]), statesAnyOf(["savings"])],
  },
  {
    id: "ledger-total",
    group: "ledger",
    turns: [`How much did I spend on ${dining.category} in total?`],
    tools: [anyToolCalled("run_sql", "query_transactions")],
    answer: [statesAmount(dining.totalMajor)],
  },
  {
    id: "ledger-ranking",
    group: "ledger",
    turns: ["What are my biggest spending categories?"],
    tools: [toolCalled("run_sql")],
    answer: [statesAmount(top.totalMajor)],
  },
  {
    id: "ledger-listing",
    group: "ledger",
    turns: [`Show me my 5 most recent ${dining.category} transactions.`],
    tools: [toolCalled("query_transactions")],
    answer: [statesAnyOf([dining.category])],
  },
  {
    id: "five-turn-thread",
    group: "thread",
    onlyAtScale: THREAD_SCALE,
    turns: [
      "What's the current balance of my checking account at my bank?",
      `How much did I spend on ${dining.category} in total?`,
      "Did I write anything down about my landlord?",
      `And how much on ${groceries.category}?`,
      "What's the next event on my calendar?",
    ],
    tools: [toolCalled("bank_get_account_balance", "notes_search_notes", "calendar_next_event")],
    answer: [statesAnyOf([B.nextEvent])],
  },
];
