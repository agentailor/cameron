import Papa from "papaparse";
import { parse as parseDateFns, isValid } from "date-fns";
import { Account, TransactionType } from "@/types/finance";
import type { ImportRow } from "@/lib/repositories/transactionRepository";
import { DEFAULT_CURRENCY } from "@/lib/config/catalog";

/**
 * CSV import internals. Kept separate from the agent tools so the parsing/normalization logic
 * can be iterated on independently. This is a THIN, un-hardened v1 loader — number/locale
 * parsing, per-row error reporting, and streaming for very large files are intentionally
 * minimal and will be refined once there is a real localized sample to test against.
 *
 * NOTE: source-agnostic. This treats the input as a generic localized CSV / bank export. No
 * assumptions are baked in about any specific product's column names — the caller (the agent)
 * supplies the column mapping.
 */

/** The mapping the agent produces from inspecting the CSV: our field <- their column header. */
export interface ColumnMapping {
  /** Column holding the amount (positive number, possibly localized). Required. */
  amount: string;
  /** Column holding the human-readable note/label. Required. */
  note: string;
  /**
   * Column indicating expense vs income. Optional: if omitted, `typeDefault` is used for all
   * rows (some exports split amount sign instead of a type column — refine later).
   */
  type?: string;
  /** Column holding the transaction date. Optional; rows with no date column default to now(). */
  date?: string;
  /** Column holding the category name. Optional. */
  category?: string;
  /** Column holding the merchant/payee. Optional. */
  merchant?: string;
  /** Column holding a longer description. Optional. */
  description?: string;
  /** Column holding a source-native unique id (used to dedup). Optional but recommended. */
  externalId?: string;
}

export interface ImportOptions {
  mapping: ColumnMapping;
  account: Account;
  currency?: string;
  /** Used when the `type` column is absent or a row's value is unrecognized. */
  typeDefault?: TransactionType;
  /** How the `type` column's raw values map to our enum (case-insensitive). */
  typeValues?: { expense: string[]; income: string[] };
  /**
   * date-fns format of the date column, read by the agent from the sample (e.g. "dd/MM/yyyy",
   * "dd/MM/yyyy HH:mm:ss", "yyyy-MM-dd"). Required to parse dates deterministically — without it
   * we can't tell "05/07" (5 Jul) from "05/07" (May 7). Rows whose date doesn't match are reported.
   */
  dateFormat?: string;
  source?: string; // provenance tag; defaults to "csv"
}

/** A row skipped because its date couldn't be parsed with the declared format. */
export interface BadDateRow {
  /** 1-based row number in the data (excludes the header row). */
  row: number;
  /** The raw date string that failed. */
  value: string;
}

export interface CsvPreview {
  headers: string[];
  sampleRows: Record<string, string>[];
  totalRows: number;
}

/** The mapping keys whose VALUES are file column headers (as opposed to config like `account`). */
const MAPPING_COLUMN_KEYS: (keyof ColumnMapping)[] = [
  "amount",
  "note",
  "type",
  "date",
  "category",
  "merchant",
  "description",
  "externalId",
];

/**
 * Return any mapping columns that aren't real file headers. Such a value reads as `undefined` for
 * every row and would drop the field silently, so the caller rejects the import instead.
 */
export function validateMapping(
  headers: string[],
  mapping: ColumnMapping,
): { unknownColumns: { field: string; column: string }[] } {
  const headerSet = new Set(headers);
  const unknownColumns: { field: string; column: string }[] = [];
  for (const key of MAPPING_COLUMN_KEYS) {
    const column = mapping[key];
    if (column && !headerSet.has(column)) {
      unknownColumns.push({ field: key, column });
    }
  }
  return { unknownColumns };
}

/** Headers present in the file that the mapping did NOT use — surfaced so nothing is dropped silently. */
export function unmappedHeaders(headers: string[], mapping: ColumnMapping): string[] {
  const used = new Set(
    MAPPING_COLUMN_KEYS.map((k) => mapping[k]).filter((v): v is string => Boolean(v)),
  );
  return headers.filter((h) => !used.has(h));
}

/**
 * Parse raw CSV text into typed records plus the parsed header row. `fields` comes from Papa's
 * metadata, so a header-only file still reports its headers (deriving them from the first record
 * would report none, making "no data" indistinguishable from "not a CSV").
 */
function parseRecords(csvText: string): { records: Record<string, string>[]; fields: string[] } {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  return { records: result.data, fields: result.meta.fields ?? [] };
}

/**
 * Inspect a CSV: return only the headers, the first few sample rows, and a total count.
 * This is all the agent ever sees — never the full data set.
 */
export function inspectCsv(csvText: string, sampleSize = 5): CsvPreview {
  const { records, fields } = parseRecords(csvText);
  return {
    headers: fields,
    sampleRows: records.slice(0, sampleSize),
    totalRows: records.length,
  };
}

/** Best-effort parse of a possibly-localized amount string to a positive decimal. */
function parseAmount(raw: string | undefined): number | null {
  if (raw == null) return null;
  // Strip currency symbols/spaces; treat both ',' and '.' as possible decimal separators.
  // Thin heuristic — to be hardened with real samples.
  const cleaned = raw.replace(/[^0-9.,-]/g, "").replace(/,/g, ".");
  const value = Number.parseFloat(cleaned);
  if (Number.isNaN(value)) return null;
  return Math.abs(value);
}

function resolveType(raw: string | undefined, opts: ImportOptions): TransactionType {
  const fallback = opts.typeDefault ?? TransactionType.expense;
  if (!raw) return fallback;
  const v = raw.trim().toLowerCase();
  const income = (opts.typeValues?.income ?? ["income", "credit", "in"]).map((s) =>
    s.toLowerCase(),
  );
  const expense = (opts.typeValues?.expense ?? ["expense", "debit", "out"]).map((s) =>
    s.toLowerCase(),
  );
  if (income.includes(v)) return TransactionType.income;
  if (expense.includes(v)) return TransactionType.expense;
  return fallback;
}

const DATE_MISSING = Symbol("date-missing");
const DATE_INVALID = Symbol("date-invalid");

/**
 * Parse a date string with the caller-supplied format. Returns the parsed date, or DATE_MISSING
 * (no value to parse — caller defaults to now()), or DATE_INVALID (a value that doesn't match the
 * format — caller reports it, never silently substitutes now()).
 *
 * The parsed wall-clock components are reinterpreted as UTC so the stored calendar day matches what
 * the file says regardless of server timezone (local-midnight → UTC would slip the date a day).
 */
function parseDate(
  raw: string | undefined,
  format?: string,
): Date | typeof DATE_MISSING | typeof DATE_INVALID {
  const value = raw?.trim();
  if (!value) return DATE_MISSING;
  // Without a declared format we cannot disambiguate DD/MM from MM/DD — refuse to guess.
  if (!format) return DATE_INVALID;
  const local = parseDateFns(value, format, new Date());
  if (!isValid(local)) return DATE_INVALID;
  return new Date(
    Date.UTC(
      local.getFullYear(),
      local.getMonth(),
      local.getDate(),
      local.getHours(),
      local.getMinutes(),
      local.getSeconds(),
    ),
  );
}

/**
 * Apply a column mapping to raw CSV text, producing {@link ImportRow}s ready for the repository's
 * atomic importer. Rows whose amount can't be parsed are skipped and counted. Rows whose date can't
 * be parsed with `opts.dateFormat` are collected in `badDateRows` (NOT silently dated now()) so the
 * caller can surface them. Categories are passed through as NAMES (`categoryName`).
 */
export function mapCsvToTransactions(
  csvText: string,
  opts: ImportOptions,
): {
  rows: ImportRow[];
  skipped: number;
  badDateRows: BadDateRow[];
  headers: string[];
} {
  const { mapping } = opts;
  const { records, fields: headers } = parseRecords(csvText);
  const rows: ImportRow[] = [];
  const badDateRows: BadDateRow[] = [];
  let skipped = 0;

  records.forEach((rec, i) => {
    const amount = parseAmount(rec[mapping.amount]);
    const note = mapping.note ? rec[mapping.note]?.trim() : "";
    if (amount == null || !note) {
      skipped++;
      return;
    }

    const rawDate = mapping.date ? rec[mapping.date] : undefined;
    const parsed = parseDate(rawDate, opts.dateFormat);
    if (parsed === DATE_INVALID) {
      // A date column was mapped but this row's value doesn't match the format. Report, don't guess.
      badDateRows.push({ row: i + 1, value: (rawDate ?? "").trim() });
      return;
    }
    const occurredAt = parsed === DATE_MISSING ? new Date() : parsed;

    rows.push({
      occurredAt,
      amountMinor: Math.round(amount * 100),
      type: resolveType(mapping.type ? rec[mapping.type] : undefined, opts),
      note,
      currency: opts.currency ?? DEFAULT_CURRENCY,
      description: mapping.description ? (rec[mapping.description] ?? null) : null,
      merchant: mapping.merchant ? (rec[mapping.merchant] ?? null) : null,
      account: opts.account,
      source: opts.source ?? "csv",
      externalId: mapping.externalId ? (rec[mapping.externalId] ?? null) : null,
      categoryName: mapping.category ? (rec[mapping.category] ?? null) : null,
    });
  });

  return { rows, skipped, badDateRows, headers };
}
