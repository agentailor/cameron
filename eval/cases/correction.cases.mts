import { RUN_POLICY } from "../config.mts";
import { DEFAULT_CURRENCY } from "../../src/lib/config/catalog.ts";
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
 * Correcting and deleting transactions (issue #12). The tools are new and the system prompt does
 * not mention them, so these cases measure what the tool DESCRIPTIONS alone achieve.
 *
 * The defect class is an edit made the wrong way while looking right: a correction logged as a
 * second row (the agent offered exactly this before the tools existed), or an id used without
 * looking it up. Graded on the database and on tool order, never on what the agent says it did.
 *
 * Deletes are a two-step conversation: the validator's rows are shown and the agent is told to wait
 * for the user's go-ahead, so those cases script a confirming second turn. Whether it actually waited
 * is NOT graded — the approval gate, not the pause, is what stops a delete, and an agent that
 * deletes straight away still has to get the click.
 */

const { update, deleteOne, deleteCategory } = FIXTURE.edits;
const LOOKUPS = ["query_transactions", "run_sql"];

/** The user's reply to the validator's rows. Harmless if the agent never stopped to ask. */
const CONFIRM_DELETE = "Yes, those are the right ones. Go ahead and delete them.";

/** The owner's currency is settled, so the correction is the only question in play. */
const USD_SET = { currency: DEFAULT_CURRENCY };

export const cases: EvalCase[] = [
  {
    id: "correction-updates-instead-of-relogging",
    description:
      "An expense logged in the wrong currency is corrected in place — one row, now EUR — not " +
      "logged a second time. The pre-#12 agent offered 're-log it', which double-counts.",
    prompt: [
      "Log a 4.20 coffee at the corner cafe on my checking account.",
      "Sorry, that coffee was actually in euros, not dollars. Please fix that transaction — " +
        "leave my default currency as it is.",
    ],
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
    prompt: [`Delete all of my ${deleteCategory.category} transactions.`, CONFIRM_DELETE],
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
    prompt: [`Delete the transaction "${deleteOne.note}".`, CONFIRM_DELETE],
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
