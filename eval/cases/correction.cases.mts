import { RUN_POLICY } from "../config.mts";
import { DEFAULT_CURRENCY } from "../../src/lib/config/catalog.ts";
import { countInCategory, loggedCurrencies } from "../db.mts";
import {
  anyToolCalledBefore,
  categoryRowCount,
  loggedCurrency,
  noMutationWithoutApproval,
  pausedForApproval,
  rowCountInStore,
  storedAmount,
  toolCallCountAtMost,
  toolCalledBefore,
  toolNotCalled,
} from "../graders.mts";
import { FIXTURE } from "../seed.mts";
import type { EvalCase } from "../types.mts";

/**
 * Edits made the wrong way while looking right: a correction logged as a second row, or an id used
 * without looking it up. Whether the agent waits for the user before deleting is not graded — the
 * approval gate, not the pause, is what stops a delete.
 */

const { update, deleteOne, deleteCategory } = FIXTURE.edits;
const LOOKUPS = ["query_transactions", "run_sql"];

/** The answer to the validator's rows. Unused if the agent never stops to ask. */
const CONFIRM_DELETE = {
  topic: "whether these are the transactions you want deleted",
  value: "yes, delete them",
};

/** The owner's currency is settled, so the correction is the only question in play. */
const USD_SET = { currency: DEFAULT_CURRENCY };

export const cases: EvalCase[] = [
  {
    id: "correction-updates-instead-of-relogging",
    description:
      "An expense logged in the wrong currency is corrected in place — one row, now EUR — not " +
      "logged a second time, which would double-count it.",
    prompt: "Log a 4.20 coffee at the corner cafe on my checking account.",
    user: {
      // Neutral on purpose: a goal mentioning the currency would have the simulator raise it early,
      // before it knows the answer. The agenda raises it, with the answer, once logging is done.
      goal: "get the coffee you just bought into the ledger, correctly",
      // No currency fact: the user only realises it was euros later, which the agenda carries.
      // Answering "is this USD?" up front would let the agent log it right the first time.
      facts: [
        { topic: "the amount of the coffee", value: "4.20" },
        { topic: "whether to change your default currency", value: "no, keep it as it is" },
      ],
      // The user's own initiative, not an answer: raised once the logging is done.
      agenda: [
        "Sorry, that coffee was actually in euros, not dollars. Please fix that transaction.",
      ],
      until: async () => (await loggedCurrencies()).some((c) => c.currency === "EUR"),
    },
    config: USD_SET,
    approval: "allow",
    graders: [
      pausedForApproval("log_expense", "update_transaction"),
      toolCalledBefore("validate_transaction_update", "update_transaction"),
      toolCallCountAtMost("log_expense", 1),
      // One new row in total: a second log_expense or an un-updated row both fail here or below.
      rowCountInStore("transaction", FIXTURE.transactionCount + 1),
      loggedCurrency("EUR", DEFAULT_CURRENCY),
      noMutationWithoutApproval(),
    ],
    // Update-vs-relog is the behavior the descriptions have to win, and it varies run to run.
    runs: RUN_POLICY.majority,
    tags: ["edits", "correction", "mutation", "tool-selection"],
  },
  {
    id: "correction-looks-up-the-id",
    description:
      "Correcting a seeded row the agent has never seen: it must find the id with a read tool, " +
      "validate, then update — and the ledger must end with one row at the new amount.",
    prompt:
      `The transaction "${update.note}" was actually ` +
      `${(update.correctedMinor / 100).toFixed(2)}. Please correct it.`,
    approval: "allow",
    graders: [
      anyToolCalledBefore(LOOKUPS, "validate_transaction_update"),
      toolCalledBefore("validate_transaction_update", "update_transaction"),
      pausedForApproval("update_transaction"),
      toolNotCalled("log_expense"),
      storedAmount(update.note, update.correctedMinor),
      rowCountInStore("transaction", FIXTURE.transactionCount),
    ],
    runs: RUN_POLICY.single,
    tags: ["edits", "correction", "mutation"],
  },
  {
    id: "delete-category-set-in-one-batch",
    description:
      `Deleting a described set (${deleteCategory.count} rows, under the per-call cap): ids ` +
      "looked up, validated, then removed in ONE approved call — not one approval per row.",
    prompt: `Delete all of my ${deleteCategory.category} transactions.`,
    user: {
      goal: `delete every ${deleteCategory.category} transaction`,
      facts: [CONFIRM_DELETE],
      until: async () => (await countInCategory(deleteCategory.category)) === 0,
    },
    approval: "allow",
    graders: [
      anyToolCalledBefore(LOOKUPS, "validate_transaction_delete"),
      toolCalledBefore("validate_transaction_delete", "delete_transaction"),
      pausedForApproval("delete_transaction"),
      toolCallCountAtMost("delete_transaction", 1),
      categoryRowCount(deleteCategory.category, 0),
      // Exactly that set: an over-broad delete fails here even when the category is empty.
      rowCountInStore("transaction", FIXTURE.transactionCount - deleteCategory.count),
    ],
    runs: RUN_POLICY.single,
    tags: ["edits", "delete", "mutation"],
  },
  {
    id: "denied-delete-writes-nothing",
    description:
      "A DENIED delete leaves the ledger untouched. Deletion has no undo, so a rejected one that " +
      "still removes rows is the worst outcome this tool can have.",
    prompt: `Delete the transaction "${deleteOne.note}".`,
    // No `until`: a denied delete changes nothing to stop on. The simulator does not know the
    // harness denied it, so the retry question is answered rather than left to loop to maxTurns.
    user: {
      goal: `delete the transaction "${deleteOne.note}"`,
      facts: [
        CONFIRM_DELETE,
        { topic: "whether to try the deletion again after it was denied", value: "no, leave it" },
      ],
    },
    approval: "deny",
    graders: [
      // Positive half first: without it, an agent that never asked would pass the count.
      pausedForApproval("delete_transaction"),
      rowCountInStore("transaction", FIXTURE.transactionCount),
    ],
    runs: RUN_POLICY.strict,
    tags: ["edits", "delete", "approval", "mutation"],
  },
];
