import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { extractTextContent } from "@/lib/storage/content";
import {
  inspectCsv,
  mapCsvToTransactions,
  validateMapping,
  unmappedHeaders,
  type ColumnMapping,
} from "@/lib/finance/csv";
import * as transactionRepo from "@/lib/repositories/transactionRepository";
import { Account, TransactionType } from "@/types/finance";
import { DEFAULT_CURRENCY } from "@/lib/config/catalog";

/**
 * CSV import as a TWO-TOOL handshake. The transaction rows NEVER pass through the agent/LLM:
 *
 *   1. inspect_csv(fileKey)            -> agent sees ONLY headers + a few sample rows
 *   2. agent reasons a column mapping  -> proposes it for the user's approval
 *   3. import_transactions_csv(...)    -> runs entirely server-side, returns a SUMMARY only
 *
 * This keeps large files out of the context window and lets the human approve the *mapping*
 * (a small, readable artifact) rather than a blind bulk write. It is also the shape a future
 * self-writing importer will use: inspect -> propose -> approve -> execute.
 */

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

export const importTransactionsCsvTool = tool(
  async (input) => {
    const text = await extractTextContent(input.fileKey);
    const mapping = input.mapping as ColumnMapping;

    const {
      rows,
      skipped: unparsable,
      badDateRows,
      headers,
    } = mapCsvToTransactions(text, {
      mapping,
      account: input.account as Account,
      currency: input.currency,
      typeDefault: (input.typeDefault as TransactionType | undefined) ?? TransactionType.expense,
      typeValues: input.typeValues,
      dateFormat: input.dateFormat,
    });

    // A mapped column that isn't a real header would be read as `undefined` for every row and
    // dropped silently (the v1 category bug). Reject up front so the agent can fix the mapping.
    const { unknownColumns } = validateMapping(headers, mapping);
    if (unknownColumns.length > 0) {
      return JSON.stringify({
        error: "mapping_references_unknown_columns",
        message:
          "The mapping references column names that are not in the file. Nothing was imported. " +
          "Copy header strings EXACTLY from the file (including accents/casing) and retry.",
        unknownColumns,
        availableHeaders: headers,
      });
    }

    // A date column was mapped but no dateFormat was supplied — dates can't be parsed unambiguously
    // (05/07 is 5 Jul or May 7?). Refuse rather than guess; the agent must confirm the format.
    if (mapping.date && !input.dateFormat) {
      return JSON.stringify({
        error: "date_format_required",
        message:
          "A date column is mapped but no dateFormat was given. Read the format from the sample " +
          "rows and confirm it with the user, then pass it as a date-fns pattern (e.g. " +
          "'dd/MM/yyyy', 'dd/MM/yyyy HH:mm:ss', 'yyyy-MM-dd'). Nothing was imported.",
      });
    }

    const {
      imported,
      skipped: duplicates,
      categorized,
      categoriesCreated,
    } = await transactionRepo.importWithCategories(rows);

    // Summary ONLY — the rows themselves never go back to the model. Category counts, unmapped
    // headers, and a bounded sample of bad-date rows make silent data-quality loss visible.
    const MAX_BAD_ROWS = 10;
    return JSON.stringify({
      imported,
      // Report the currency actually written. A fallback nobody chose must be visible in the
      // result, not just implied by its absence from the arguments.
      currency: input.currency ?? DEFAULT_CURRENCY,
      currencyWasDefaulted: input.currency === undefined,
      skippedDuplicates: duplicates,
      skippedUnparsable: unparsable,
      skippedBadDate: badDateRows.length,
      total: rows.length + unparsable + badDateRows.length,
      categorized,
      uncategorized: rows.length - categorized,
      categoriesCreated,
      unmappedHeaders: unmappedHeaders(headers, mapping),
      // Show the user which rows failed to parse (bounded so a big file can't flood context).
      badDateRows: badDateRows.slice(0, MAX_BAD_ROWS),
      badDateRowsTruncated: badDateRows.length > MAX_BAD_ROWS,
    });
  },
  {
    name: "import_transactions_csv",
    description:
      "Import all transactions from a previously-inspected CSV using a column mapping you provide. " +
      "Runs entirely server-side and returns only a summary of counts (imported / skipped / " +
      "categorized / uncategorized / categoriesCreated / unmappedHeaders). This mutates financial " +
      "records in bulk and will require the user's approval — propose the mapping to the user first. " +
      "Map every meaningful column, INCLUDING category, using the EXACT header strings from " +
      "inspect_csv; a mapping that names a column not in the file is rejected (nothing imported) so " +
      "you can fix it. When a date column is mapped you MUST pass `dateFormat`. BEFORE importing, " +
      "you must also know the currency: call `get_config` first, and if it reports `isSet: false`, " +
      "ask the user which currency the file is in and save it with `set_config`. Every row lands " +
      "under one code, and nothing in the file states it — a wrong one is silent across the whole " +
      "import. Re-importing the same file does not create duplicates. The summary lists any rows " +
      "whose date failed to parse.",
    schema: z.object({
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
            "Rows that don't match are reported back, not imported with today's date.",
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
    }),
  },
);

/** CSV import handshake tools, registered into the agent in agent/index.ts. */
export const csvImportTools = [inspectCsvTool, importTransactionsCsvTool];
