import { RUN_POLICY } from "../config.mts";
import {
  importedCategories,
  importedInMonth,
  importedRowCount,
  pausedForApproval,
  toolCalled,
  toolCalledWith,
  toolNotCalled,
} from "../graders.mts";
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
 */

const { csv } = FIXTURE;

/** The attachment reference the app injects for a non-image upload (see storage/content.ts). */
const ATTACHMENT = `[Attached file: ${csv.fileName} (text/csv, ${csv.rowCount} rows). fileKey: ${csv.fileKey}]`;

export const cases: EvalCase[] = [
  {
    id: "csv-import-confirms-ambiguous-date-format",
    description:
      "The agent must inspect and propose before importing, and must not guess an ambiguous date " +
      "format. Graded on where the rows landed: 5 July (correct) vs 7 May (read backwards).",
    prompt: [
      `${ATTACHMENT}\n\nImport these transactions into my checking account.`,
      // The user answers the question the prompt requires the agent to ask. If it already imported
      // on turn 1, the graders below catch it — this turn cannot un-import anything.
      `Yes — those dates are ${csv.dateFormat} (so 05/07/2026 is 5 July). Go ahead.`,
    ],
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
    ],
    // A wrong date format imports cleanly and silently — one bad run is a real defect.
    runs: RUN_POLICY.strict,
    tags: ["csv", "import", "mutation"],
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
    prompt: [
      `${ATTACHMENT}\n\nImport these into checking, and keep the categories from the file.`,
      `Yes — the dates are ${csv.dateFormat}. Go ahead.`,
    ],
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
];
