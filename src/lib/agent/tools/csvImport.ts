import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createHash } from "node:crypto";
import { extractTextContent } from "@/lib/storage/content";
import {
  inspectCsv,
  mapCsvToTransactions,
  readCsvRows,
  validateMapping,
  unmappedHeaders,
  type ColumnMapping,
  type MappedCsv,
} from "@/lib/finance/csv";
import * as transactionRepo from "@/lib/repositories/transactionRepository";
import { Account, TransactionType } from "@/types/finance";
import { DEFAULT_CURRENCY } from "@/lib/config/catalog";

/**
 * CSV import as a multi-tool handshake. The transaction rows NEVER pass through the agent/LLM
 * in bulk:
 *
 *   1. inspect_csv(fileKey)            -> agent sees ONLY headers + a few sample rows
 *   2. agent reasons a column mapping  -> proposes it to the user
 *   3. validate_csv_import(...)        -> parses the WHOLE file, writes nothing, returns counts
 *   4. import_transactions_csv(...)    -> runs server-side, returns a SUMMARY only
 *
 * plus `read_csv_rows` to fetch specific rows by number when some are refused.
 *
 * This keeps large files out of the context window and lets the human approve the *mapping*
 * (a small, readable artifact) rather than a blind bulk write.
 *
 * Validation is its own tool, not a `dryRun` flag: approval is keyed by tool NAME, so only a
 * separate tool can auto-approve while the import stays gated. See docs/CSV_IMPORT_FLOW.md.
 */

/** Cap on rows returned by `read_csv_rows` — bounded so recovery can't flood the context. */
const MAX_ROWS_READ = 25;

/**
 * Identity of a proposed import: the file plus every argument that changes what gets written, so
 * changing only the date format re-triggers validation rather than reusing a stale one.
 */
function importFingerprint(input: {
  fileKey: string;
  mapping: ColumnMapping;
  account: string;
  currency?: string;
  dateFormat?: string;
  typeDefault?: string;
  typeValues?: { expense: string[]; income: string[] };
}): string {
  const canonical = JSON.stringify({
    fileKey: input.fileKey,
    // Zod rebuilds parsed objects in schema key order, so `mapping` arrives already normalized.
    mapping: input.mapping,
    account: input.account,
    currency: input.currency ?? null,
    dateFormat: input.dateFormat ?? null,
    typeDefault: input.typeDefault ?? null,
    typeValues: input.typeValues
      ? {
          expense: [...input.typeValues.expense].sort(),
          income: [...input.typeValues.income].sort(),
        }
      : null,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Validated plan fingerprints. In-memory on purpose: forgetting costs a redundant validation
 * (harmless, writes nothing), while persisting would risk honouring a stale one.
 */
const validatedPlans = new Set<string>();

/** Shared shape returned by validation and by the real import, so the two cannot drift. */
function summarize(mapped: MappedCsv, currency: string | undefined) {
  const total = mapped.rows.length + mapped.unparsableRows.length + mapped.badDateRows.length;
  return {
    currency: currency ?? DEFAULT_CURRENCY,
    currencyWasDefaulted: currency === undefined,
    total,
    skippedUnparsable: mapped.unparsableRows.length,
    skippedBadDate: mapped.badDateRows.length,
    // A row silently dated midnight is indistinguishable from one the file timestamped at midnight.
    datesWithoutTime: mapped.datesWithoutTime,
    // Row NUMBERS only — content comes from `read_csv_rows`, so this payload stays the same size
    // whether 9 rows failed or 3000.
    badDateRows: mapped.badDateRows.slice(0, MAX_BAD_ROWS),
    badDateRowsTruncated: mapped.badDateRows.length > MAX_BAD_ROWS,
    unparsableRows: mapped.unparsableRows.slice(0, MAX_BAD_ROWS),
    unparsableRowsTruncated: mapped.unparsableRows.length > MAX_BAD_ROWS,
  };
}

const MAX_BAD_ROWS = 10;

const accountEnum = z.enum(["CHECKING", "SAVINGS", "CREDIT", "CASH"]);

export const inspectCsvTool = tool(
  async (input) => {
    // A bad fileKey or an unreadable file must come back as a structured, actionable error —
    // a raw throw gives the agent nothing to correct and it retries the same call.
    let text: string;
    try {
      text = await extractTextContent(input.fileKey);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return JSON.stringify({
        error: "file_unreadable",
        message:
          `Could not read the file for fileKey "${input.fileKey}": ${message}. Use the exact ` +
          "fileKey from the attachment reference ([Attached file: … fileKey: <key>]) — do not " +
          "invent or guess one, and ask the user to re-upload if there is no such reference.",
      });
    }

    const preview = inspectCsv(text, 5);
    // Distinguish "not a CSV" from "a CSV with nothing in it" — they need different replies.
    if (preview.headers.length === 0) {
      return JSON.stringify({
        error: "no_columns_found",
        message:
          "No header row could be parsed, so there are no columns to map. Confirm the upload is " +
          "a CSV with a header row.",
        totalRows: preview.totalRows,
      });
    }
    if (preview.totalRows === 0) {
      return JSON.stringify({
        error: "no_data_rows",
        message:
          "The file has a valid header row but no data rows, so there is nothing to import. " +
          "Tell the user the file is empty and ask for one containing transactions.",
        headers: preview.headers,
      });
    }

    // Return only headers + a few sample rows + a count. Never the full data.
    return JSON.stringify(preview);
  },
  {
    name: "inspect_csv",
    description:
      "Inspect an uploaded CSV of transactions: returns only its column headers, a few sample " +
      "rows, and the total row count — NOT the full data. Use this first to understand the file's " +
      "columns, then reason a column mapping to propose to the user before importing. IMPORTANT: " +
      "when you build the mapping, copy each header string EXACTLY as returned here — including " +
      "accents, spaces, and capitalization (e.g. 'Catégorie', not 'Category'). Do NOT translate or " +
      "normalize header names; a value that isn't an exact header is rejected by the import.",
    schema: z.object({
      fileKey: z.string().min(1).describe("The storage key of the previously uploaded CSV file"),
    }),
  },
);

export const readCsvRowsTool = tool(
  async (input) => {
    let text: string;
    try {
      text = await extractTextContent(input.fileKey);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return JSON.stringify({
        error: "file_unreadable",
        message: `Could not read the file for fileKey "${input.fileKey}": ${message}.`,
      });
    }

    const explicit = input.rows ?? [];
    const ranged: number[] = [];
    if (input.start !== undefined) {
      const end = input.end ?? input.start;
      for (let n = input.start; n <= end && ranged.length <= MAX_ROWS_READ; n++) ranged.push(n);
    }
    const wanted = [...explicit, ...ranged];
    if (wanted.length === 0) {
      return JSON.stringify({
        error: "no_rows_requested",
        message: "Pass `rows` (a list of row numbers) and/or `start`/`end`. Nothing was read.",
      });
    }

    const result = readCsvRows(text, wanted, MAX_ROWS_READ);
    return JSON.stringify({
      ...result,
      ...(result.truncated
        ? { hint: `Only the first ${MAX_ROWS_READ} requested rows are returned. Ask for fewer.` }
        : {}),
      ...(result.missing.length > 0
        ? {
            hint_missing:
              `Row numbers in \`missing\` are outside the file (it has ${result.totalRows} data ` +
              "rows). Row numbers are 1-based over data rows, excluding the header.",
          }
        : {}),
    });
  },
  {
    name: "read_csv_rows",
    description:
      "Read specific rows of an uploaded CSV by row NUMBER, exactly as they appear in the file " +
      "(raw values keyed by header). Row numbers are 1-based over data rows, excluding the header " +
      "row — the same numbering used by `badDateRows` and `unparsableRows` in the import and " +
      "validation results. Use this to recover rows an import refused: read them, then log them " +
      "individually with `log_expense` (correcting whatever was wrong), rather than re-running the " +
      "whole import. Re-importing a file to rescue a few rows DUPLICATES everything that already " +
      "imported. Bounded: at most " +
      String(MAX_ROWS_READ) +
      " rows per call.",
    schema: z.object({
      fileKey: z.string().min(1).describe("The storage key of the uploaded CSV file"),
      rows: z
        .array(z.number().int().positive())
        .optional()
        .describe(
          "Specific row numbers to read, e.g. [1, 5, 15]. Prefer this for failed rows — they are " +
            "usually scattered, and a range would pull in hundreds of rows you don't need.",
        ),
      start: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("First row of a contiguous range to read (1-based, data rows only)"),
      end: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Last row of the range; defaults to `start` when omitted"),
    }),
  },
);

// The mapping the agent submits: our field <- the file's column header.
const mappingSchema = z.object({
  amount: z.string().describe("Header of the column holding the amount (positive number)"),
  note: z.string().describe("Header of the column holding a short human-readable label"),
  type: z.string().optional().describe("Header of the expense/income column, if the file has one"),
  date: z.string().optional().describe("Header of the transaction date column"),
  category: z.string().optional().describe("Header of the category-name column"),
  merchant: z.string().optional().describe("Header of the merchant/payee column"),
  description: z.string().optional().describe("Header of a longer-description column"),
  externalId: z
    .string()
    .optional()
    .describe(
      "Header of a column with a source-native unique id (used to avoid duplicate imports)",
    ),
});

/** Shared verbatim by both tools, so a validated plan cannot differ from the executed one. */
const importPlanSchema = {
  fileKey: z.string().min(1).describe("The storage key of the uploaded CSV file"),
  mapping: mappingSchema.describe("How the file's columns map onto transaction fields"),
  account: accountEnum.describe("Which account these transactions belong to"),
  currency: z
    .string()
    .optional()
    .describe(
      "ISO currency code applied to EVERY imported row. Establish it before importing: call " +
        "`get_config` for the owner's currency, and if it is not set ask the user rather " +
        "than inferring one from the file's language or its merchants. Omitting this imports " +
        "hundreds of rows under a default nobody chose.",
    ),
  dateFormat: z
    .string()
    .optional()
    .describe(
      "date-fns format of the date column, e.g. 'dd/MM/yyyy', 'dd/MM/yyyy HH:mm:ss', " +
        "'yyyy-MM-dd', 'MM/dd/yyyy'. REQUIRED whenever a date column is mapped — read it from " +
        "the sample rows and CONFIRM it with the user (e.g. is '05/07/2026' 5 July or 7 May?). " +
        "A row whose value omits the time still imports (at 00:00:00) and is counted in " +
        "`datesWithoutTime`, so declare the format with the time when most rows carry one.",
    ),
  typeDefault: z
    .enum(["expense", "income"])
    .optional()
    .describe("Fallback direction when the file has no type column (default: expense)"),
  typeValues: z
    .object({
      expense: z.array(z.string()).describe("Raw values in the type column that mean EXPENSE"),
      income: z.array(z.string()).describe("Raw values in the type column that mean INCOME"),
    })
    .optional()
    .describe(
      "How the type column's raw values map to expense/income. REQUIRED when the file's type " +
        "column uses non-English or non-obvious values (e.g. { expense: ['Gasto'], income: " +
        "['Ingreso'] }). Read these from the sample rows you inspected.",
    ),
};

type ImportPlanInput = {
  fileKey: string;
  mapping: ColumnMapping;
  account: string;
  currency?: string;
  dateFormat?: string;
  typeDefault?: string;
  typeValues?: { expense: string[]; income: string[] };
};

/**
 * Parse + validate a plan without touching the database. Returns either a structured error (the
 * same one both tools return) or the mapped result. ONE code path, so validation can never
 * predict counts the real import wouldn't produce.
 */
async function parsePlan(
  input: ImportPlanInput,
): Promise<{ error: object } | { mapped: MappedCsv }> {
  let text: string;
  try {
    text = await extractTextContent(input.fileKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: {
        error: "file_unreadable",
        message:
          `Could not read the file for fileKey "${input.fileKey}": ${message}. Use the exact ` +
          "fileKey from the attachment reference.",
      },
    };
  }

  const mapping = input.mapping;
  const mapped = mapCsvToTransactions(text, {
    mapping,
    account: input.account as Account,
    currency: input.currency,
    typeDefault: (input.typeDefault as TransactionType | undefined) ?? TransactionType.expense,
    typeValues: input.typeValues,
    dateFormat: input.dateFormat,
  });

  // A mapped column that isn't a real header would be read as `undefined` for every row and
  // dropped silently (the v1 category bug). Reject up front so the agent can fix the mapping.
  const { unknownColumns } = validateMapping(mapped.headers, mapping);
  if (unknownColumns.length > 0) {
    return {
      error: {
        error: "mapping_references_unknown_columns",
        message:
          "The mapping references column names that are not in the file. Nothing was imported. " +
          "Copy header strings EXACTLY from the file (including accents/casing) and retry.",
        unknownColumns,
        availableHeaders: mapped.headers,
      },
    };
  }

  // A date column was mapped but no dateFormat was supplied — dates can't be parsed unambiguously
  // (05/07 is 5 Jul or May 7?). Refuse rather than guess; the agent must confirm the format.
  if (mapping.date && !input.dateFormat) {
    return {
      error: {
        error: "date_format_required",
        message:
          "A date column is mapped but no dateFormat was given. Read the format from the sample " +
          "rows and confirm it with the user, then pass it as a date-fns pattern (e.g. " +
          "'dd/MM/yyyy', 'dd/MM/yyyy HH:mm:ss', 'yyyy-MM-dd'). Nothing was imported.",
      },
    };
  }

  return { mapped };
}

export const validateCsvImportTool = tool(
  async (input) => {
    const plan = input as ImportPlanInput;
    const result = await parsePlan(plan);
    if ("error" in result) return JSON.stringify(result.error);

    const { mapped } = result;
    validatedPlans.add(importFingerprint(plan));

    const summary = summarize(mapped, plan.currency);
    const refused = mapped.unparsableRows.length + mapped.badDateRows.length;
    return JSON.stringify({
      ok: true,
      validated: true,
      wouldImport: mapped.rows.length,
      ...summary,
      categorizedPreview: mapped.rows.filter((r) => r.categoryName?.trim()).length,
      unmappedHeaders: unmappedHeaders(mapped.headers, plan.mapping),
      // Steer the two failure shapes apart: a few scattered refusals are ROW problems to recover
      // one by one; a majority refused is a MAPPING problem, and re-importing is right only then.
      ...(refused > 0
        ? {
            hint:
              refused > mapped.rows.length
                ? "Most rows were refused — the mapping or dateFormat is probably wrong. Fix it " +
                  "and validate again. Nothing has been written."
                : `${refused} row(s) were refused while ${mapped.rows.length} parsed cleanly. ` +
                  "Import the good rows, then read the refused ones with `read_csv_rows` and log " +
                  "them individually. Do NOT re-import the file to rescue them — that duplicates " +
                  "everything that already imported.",
          }
        : {}),
    });
  },
  {
    name: "validate_csv_import",
    description:
      "Check an import plan against the WHOLE file without writing anything, and report exactly " +
      "what would happen: how many rows would import, which would be refused and why. You MUST " +
      "call this before `import_transactions_csv` — the import refuses a plan that has not been " +
      "validated. Pass the same arguments you intend to import with; if you then change any of " +
      "them (including `dateFormat`), validate again. This writes nothing and needs no approval, " +
      "so prefer it over guessing: the sample rows from `inspect_csv` are 5 rows out of possibly " +
      "thousands, and a format that fits them can still fail most of the file. Refused rows are " +
      "reported by ROW NUMBER — read them with `read_csv_rows`.",
    schema: z.object(importPlanSchema),
  },
);

export const importTransactionsCsvTool = tool(
  async (input) => {
    const plan = input as ImportPlanInput;

    // Parse FIRST, so a malformed plan gets its specific, correctable error before the gate.
    const result = await parsePlan(plan);
    if ("error" in result) return JSON.stringify(result.error);

    // Then the gate, checked against state WE recorded — never an argument the model asserts.
    if (!validatedPlans.has(importFingerprint(plan))) {
      return JSON.stringify({
        error: "validation_required",
        message:
          "This exact import plan has not been validated. Call `validate_csv_import` with these " +
          "same arguments first, check what it reports, and only then import. Nothing was " +
          "written. (If you changed any argument — including dateFormat — since validating, that " +
          "is a different plan and needs validating again.)",
      });
    }

    const { mapped } = result;
    const mapping = plan.mapping;

    const { imported, categorized, categoriesCreated } = await transactionRepo.importWithCategories(
      mapped.rows,
    );

    const refused = mapped.unparsableRows.length + mapped.badDateRows.length;
    // Summary ONLY — the rows themselves never go back to the model.
    return JSON.stringify({
      imported,
      ...summarize(mapped, plan.currency),
      categorized,
      uncategorized: mapped.rows.length - categorized,
      categoriesCreated,
      unmappedHeaders: unmappedHeaders(mapped.headers, mapping),
      // Deliberately NOT `skippedDuplicates: 0`. Dedup keys on (source, externalId) and NULL never
      // equals NULL in Postgres, so with no id column nothing is deduplicated at all — a 0 here
      // would read as "checked, none found".
      duplicateDetection: mapping.externalId ? "active" : "unavailable",
      ...(mapping.externalId
        ? {}
        : {
            duplicateWarning:
              "This file has no unique-id column, so duplicate detection is OFF: importing it " +
              "again would create a SECOND copy of every row. To recover refused rows, read them " +
              "with `read_csv_rows` and log them individually — never re-import the file.",
          }),
      ...(refused > 0
        ? {
            hint:
              `${refused} row(s) were refused. Read them with \`read_csv_rows\` (they are listed ` +
              "by row number) and log them individually with `log_expense`. Re-importing the file " +
              "would duplicate the rows that just imported.",
          }
        : {}),
    });
  },
  {
    name: "import_transactions_csv",
    description:
      "Import all transactions from a previously-inspected CSV using a column mapping you provide. " +
      "Runs entirely server-side and returns only a summary of counts. This mutates financial " +
      "records in bulk and will require the user's approval — propose the mapping to the user first. " +
      "You MUST call `validate_csv_import` with these exact arguments first: an unvalidated plan is " +
      "refused and nothing is written. Map every meaningful column, INCLUDING category, using the " +
      "EXACT header strings from inspect_csv; a mapping that names a column not in the file is " +
      "rejected (nothing imported) so you can fix it. When a date column is mapped you MUST pass " +
      "`dateFormat`. BEFORE importing, you must also know the currency: call `get_config` first, " +
      "and if it reports `isSet: false`, ask the user which currency the file is in and save it " +
      "with `set_config`. Every row lands under one code, and nothing in the file states it — a " +
      "wrong one is silent across the whole import. IMPORTANT: unless the file has a unique-id " +
      "column mapped to `externalId`, duplicates are NOT detected — importing the same file twice " +
      "creates a second copy of every row. To recover rows this refused, read them with " +
      "`read_csv_rows` and log them individually; never re-import the file to rescue a few rows.",
    schema: z.object(importPlanSchema),
  },
);

/** CSV import handshake tools, registered into the agent in agent/index.ts. */
export const csvImportTools = [
  inspectCsvTool,
  readCsvRowsTool,
  validateCsvImportTool,
  importTransactionsCsvTool,
];
