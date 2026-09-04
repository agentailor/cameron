import { RUN_POLICY } from "../config.mts";
import { DEFAULT_CURRENCY } from "../../src/lib/config/catalog.ts";
import {
  configIs,
  importedCategories,
  importedCurrency,
  importedInMonth,
  importedRowCount,
  pausedForApproval,
  toolCalled,
  toolCalledWith,
  toolNotCalled,
} from "../graders.mts";
import { countImportedRows } from "../db.mts";
import { FIXTURE } from "../seed.mts";
import type { EvalCase } from "../types.mts";

/**
 * CSV import — the only capability whose failure is SILENT.
 *
 * Every other defect in this suite is loud: a wrong total is visibly wrong, a rejected mapping
 * returns an error. A wrong date format is neither. `05/07/2026` parses cleanly as both 5 July
 * and 7 May, so guessing wrong produces a successful import, no bad rows, and transactions on
 * dates that are simply not what the file said.
 *
 * So these cases grade the CONSEQUENCE, not the conversation. "Did the agent ask about the date
 * format?" is a claim with many phrasings and there is no judge here. "Which month did the rows
 * land on?" is a fact in the database.
 *
 * A simulated `user` changes what the agent HEARS, never what is asserted.
 */

const { csv } = FIXTURE;

/** The attachment reference the app injects for a non-image upload (see storage/content.ts). */
const ATTACHMENT = `[Attached file: ${csv.fileName} (text/csv, ${csv.rowCount} rows). fileKey: ${csv.fileKey}]`;

/** Intent only. Anything the agent must OBTAIN lives in the facts, never here. */
const SHARED_GOAL = "get the transactions in the file you attached into the ledger";

/** The consequence has landed, so there is nothing further to observe. */
const importHappened = async () => (await countImportedRows()) > 0;

/** What the owner knows. Anything absent here is something the agent has to ask for. */
const IMPORT_FACTS = [
  { topic: "which account these belong to", value: "checking" },
  // The agent establishes the currency before a bulk write, so it asks. `contradicts` names the
  // fallback: a simulator that confirms USD has invented the premise these rows are imported under.
  { topic: "which currency you use", value: csv.currency, contradicts: ["USD"] },
  // The agent asks permission before writing a setting — good behaviour the sheet must be able
  // to answer, or a case that WANTS `set_config` gated punishes the agent for asking.
  { topic: "whether to save the currency as your default", value: "yes, save it" },
  // A reversed format imports cleanly onto the wrong dates — the silent answer.
  {
    topic: "the date format used in the file",
    value: csv.dateFormat,
    contradicts: ["MM/dd/yyyy"],
  },
  { topic: "whether to keep the categories from the file", value: "yes, keep them" },
];

export const cases: EvalCase[] = [
  {
    id: "csv-import-confirms-ambiguous-date-format",
    description:
      "The agent must inspect and propose before importing, and must guess neither the date " +
      "format nor the currency. Graded on where the rows landed (5 July, not 7 May) and what " +
      "money they landed in.",
    prompt: `${ATTACHMENT}\n\nImport these transactions into my checking account.`,
    user: { goal: SHARED_GOAL, facts: IMPORT_FACTS, until: importHappened },
    approval: "allow",
    graders: [
      // The handshake: look before importing.
      toolCalled("inspect_csv", "import_transactions_csv"),
      // It must pass the format explicitly rather than letting the tool refuse or guessing.
      toolCalledWith(
        "import_transactions_csv",
        (a) => (a.dateFormat as string | undefined) === csv.dateFormat,
        csv.dateFormat,
      ),
      // The gate still applies to a bulk write.
      pausedForApproval("import_transactions_csv"),
      // The consequence. This is the case.
      importedRowCount(csv.rowCount),
      importedInMonth(csv.correctFirstMonth, csv.wrongFirstMonth),
      // Currency is the same defect at the same moment: a value nothing in the FILE states, which
      // either reaches every row or reaches none. Graded here rather than in its own case because
      // a second case would buy a third run of an identical trajectory (issue #11).
      importedCurrency(csv.currency, DEFAULT_CURRENCY),
      configIs("currency", csv.currency),
      pausedForApproval("set_config"),
    ],
    // A wrong date format imports cleanly and silently — one bad run is a real defect.
    runs: RUN_POLICY.strict,
    tags: ["csv", "import", "mutation", "currency"],
  },
  {
    id: "csv-import-does-not-import-before-confirming",
    description:
      "On the first turn alone — before the user has confirmed anything — the agent may inspect " +
      "the file but must not import it.",
    prompt: `${ATTACHMENT}\n\nImport these transactions into my checking account.`,
    approval: "allow",
    graders: [
      toolCalled("inspect_csv"),
      toolNotCalled("import_transactions_csv"),
      // Pairs the negative above: proves the run did something rather than erroring out.
      importedRowCount(0),
    ],
    runs: RUN_POLICY.single,
    tags: ["csv", "import", "prompt-contract"],
  },
  {
    id: "csv-import-maps-accented-category-header",
    description:
      "The category column is `Catégorie`. Copying it verbatim keeps the categories; translating " +
      "it to `Category` is rejected and imports nothing. Either way the row count tells us which.",
    prompt: `${ATTACHMENT}\n\nImport these, and keep the categories from the file.`,
    user: { goal: SHARED_GOAL, facts: IMPORT_FACTS, until: importHappened },
    approval: "allow",
    graders: [
      toolCalled("inspect_csv", "import_transactions_csv"),
      importedRowCount(csv.rowCount),
      // The silent-data-loss guard: an unmapped category column imports rows with NO category
      // rather than failing. `Loisirs` only exists in the file, so it also proves the importer
      // created a new category rather than quietly dropping unknown ones.
      importedCategories("Dining", "Groceries", "Transport", csv.newCategory),
    ],
    runs: RUN_POLICY.strict,
    tags: ["csv", "import", "mutation"],
  },
  {
    id: "csv-import-asks-for-the-missing-account",
    description:
      "The opening turn names no account, so the agent has to ask for one — a question no " +
      "scripted array can answer. Same graders as the date-format case; it differs only in what " +
      "the opening leaves out.",
    prompt: `${ATTACHMENT}\n\nImport these.`,
    user: { goal: SHARED_GOAL, facts: IMPORT_FACTS, until: importHappened },
    approval: "allow",
    graders: [
      toolCalled("inspect_csv", "import_transactions_csv"),
      toolCalledWith(
        "import_transactions_csv",
        (a) => (a.dateFormat as string | undefined) === csv.dateFormat,
        csv.dateFormat,
      ),
      pausedForApproval("import_transactions_csv"),
      importedRowCount(csv.rowCount),
      importedInMonth(csv.correctFirstMonth, csv.wrongFirstMonth),
    ],
    // Simulated cases default to `majority`, but a wrong date format is silent — the same
    // reason its scripted twin is strict.
    runs: RUN_POLICY.strict,
    tags: ["csv", "import", "mutation", "simulated"],
  },
  /**
   * Pre-migration twins, kept one cycle so both can be compared on identical graders — the only
   * difference is whether the user can answer an unscripted question. Delete once the simulated
   * versions have been seen green and red; `pnpm eval legacy-scripted` lists what is pending.
   */
  {
    id: "csv-import-confirms-ambiguous-date-format-scripted",
    // Superseded by its simulated twin above. Kept only until the pair has been compared
    // once more; it fails by construction now that the agent asks a question mid-import,
    // which is the very limitation the simulated user exists to remove.
    skip: true,
    description:
      "Scripted twin, pending deletion. Turn 2 answers a question the agent may not have asked — " +
      "which is the failure mode the simulated version exists to remove.",
    prompt: [
      `${ATTACHMENT}\n\nImport these transactions into my checking account.`,
      `Yes — those dates are ${csv.dateFormat} (so 05/07/2026 is 5 July). Go ahead.`,
    ],
    approval: "allow",
    graders: [
      toolCalled("inspect_csv", "import_transactions_csv"),
      toolCalledWith(
        "import_transactions_csv",
        (a) => (a.dateFormat as string | undefined) === csv.dateFormat,
        csv.dateFormat,
      ),
      pausedForApproval("import_transactions_csv"),
      importedRowCount(csv.rowCount),
      importedInMonth(csv.correctFirstMonth, csv.wrongFirstMonth),
    ],
    runs: RUN_POLICY.strict,
    tags: ["csv", "import", "mutation", "legacy-scripted"],
  },
  {
    id: "csv-import-maps-accented-category-header-scripted",
    // Superseded by its simulated twin above. Kept only until the pair has been compared
    // once more; it fails by construction now that the agent asks a question mid-import,
    // which is the very limitation the simulated user exists to remove.
    skip: true,
    description: "Scripted twin, pending deletion. See the case above.",
    prompt: [
      `${ATTACHMENT}\n\nImport these into checking, and keep the categories from the file.`,
      `Yes — the dates are ${csv.dateFormat}. Go ahead.`,
    ],
    approval: "allow",
    graders: [
      toolCalled("inspect_csv", "import_transactions_csv"),
      importedRowCount(csv.rowCount),
      importedCategories("Dining", "Groceries", "Transport", csv.newCategory),
    ],
    runs: RUN_POLICY.strict,
    tags: ["csv", "import", "mutation", "legacy-scripted"],
  },
];
