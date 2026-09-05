import { RUN_POLICY } from "../config.mts";
import { DEFAULT_CURRENCY } from "../../src/lib/config/catalog.ts";
import { configValue, loggedCurrencies } from "../db.mts";
import {
  configIs,
  loggedCurrency,
  pausedForApproval,
  rowCountInStore,
  toolCalled,
  toolCalledBefore,
  toolNeverCalledWith,
} from "../graders.mts";
import { FIXTURE } from "../seed.mts";
import type { EvalCase } from "../types.mts";

/**
 * Config establishment: settings the agent must get from the owner rather than assume.
 *
 * The defect class is a locale-dependent value with a plausible default that is wrong SILENTLY —
 * currency is the instance (issue #11). There is no server-side guard: the tools do NOT refuse on
 * a missing currency the way they refuse on a missing date format, because a misread date destroys
 * information while a wrong currency is repairable. The tool descriptions are the whole mechanism,
 * which is why it needs an eval.
 *
 * Both halves are here: without the establish case the agent can silently default, and without the
 * reuse case a store the agent re-asks past looks identical to one that works. The IMPORT side is
 * graded in csvImport.cases.mts, on the handshake it shares.
 */

const { csv } = FIXTURE;

/** Intent only — naming the currency here would leak the very thing the agent must ask for. */
const LOG_GOAL = "get the coffee you just bought into the ledger";

/** The owner banks in euros; a simulator confirming the fallback has fabricated the premise. */
const CURRENCY_FACT = {
  topic: "which currency you use",
  value: csv.currency,
  contradicts: [DEFAULT_CURRENCY],
};

const ACCOUNT_FACT = { topic: "which account this belongs to", value: "checking" };

/** A preference, not a value: without it the agent is refused for asking permission to save. */
const SAVE_CURRENCY_FACT = {
  topic: "whether to save the currency as your default",
  value: "yes, save it",
};

const expenseLogged = async () => (await loggedCurrencies()).length > 0;
/** Both halves must land: the setting saved AND the row written. */
const currencySavedAndLogged = async () =>
  (await configValue("currency")) !== null && (await expenseLogged());

export const cases: EvalCase[] = [
  {
    id: "config-log-expense-establishes-currency-first",
    description:
      "With config empty and no currency in the prompt, the agent must ask and save the answer " +
      "BEFORE logging — not write under the fallback and backfill the setting after.",
    // The amount carries no currency, so the agent has to ask.
    prompt: "Log a 4.20 coffee at the corner cafe on my checking account.",
    user: {
      goal: LOG_GOAL,
      facts: [CURRENCY_FACT, SAVE_CURRENCY_FACT, ACCOUNT_FACT],
      until: currencySavedAndLogged,
    },
    approval: "allow",
    graders: [
      toolCalled("get_config", "set_config", "log_expense"),
      toolCalledBefore("set_config", "log_expense"),
      configIs("currency", csv.currency),
      loggedCurrency(csv.currency, DEFAULT_CURRENCY),
      rowCountInStore("transaction", FIXTURE.transactionCount + 1),
      pausedForApproval("log_expense"),
    ],
    // Whether it asks at all is the part that varies run to run.
    runs: RUN_POLICY.majority,
    tags: ["config", "currency", "mutation", "prompt-contract", "simulated"],
  },
  {
    id: "config-log-expense-reuses-stored-currency",
    description:
      "With the currency already established, the agent reads it and logs in it — no re-asking, " +
      "no redundant approval prompt to re-save what is already stored.",
    config: { currency: csv.currency },
    prompt: "Log a 4.20 coffee at the corner cafe on my checking account.",
    // No CURRENCY_FACT: it is already stored, so an agent that asks anyway goes inconclusive.
    user: { goal: LOG_GOAL, facts: [ACCOUNT_FACT], until: expenseLogged },
    approval: "allow",
    graders: [
      toolCalled("get_config"),
      loggedCurrency(csv.currency, DEFAULT_CURRENCY),
      rowCountInStore("transaction", FIXTURE.transactionCount + 1),
      toolNeverCalledWith("set_config", (a) => a.key === "currency", "key=currency"),
      pausedForApproval("log_expense"),
    ],
    runs: RUN_POLICY.single,
    tags: ["config", "currency", "mutation", "simulated"],
  },
];
