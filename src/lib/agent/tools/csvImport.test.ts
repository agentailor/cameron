import { beforeEach, describe, expect, it, vi } from "vitest";
import { callTool } from "./testing";

/**
 * Contract tests for the CSV import handshake — storage and repository stubbed.
 * Invariant: any path that would silently lose data must error and import nothing.
 */

vi.mock("@/lib/storage/content", () => ({ extractTextContent: vi.fn() }));
vi.mock("@/lib/repositories/transactionRepository", () => ({ importWithCategories: vi.fn() }));

const { extractTextContent } = await import("@/lib/storage/content");
const transactionRepo = await import("@/lib/repositories/transactionRepository");
const { inspectCsvTool, importTransactionsCsvTool, validateCsvImportTool, readCsvRowsTool } =
  await import("./csvImport");

const CSV = [
  "Date,Libellé,Montant,Catégorie",
  "05/07/2026,Café du coin,4.50,Restaurants",
  "06/07/2026,Boulangerie,3.20,Restaurants",
].join("\n");

const MAPPING = {
  amount: "Montant",
  note: "Libellé",
  date: "Date",
  category: "Catégorie",
};

beforeEach(() => {
  vi.resetAllMocks();
});

/** The import refuses an unvalidated plan, so every import test goes through validation first. */
async function validateThenImport(plan: Record<string, unknown>) {
  await callTool(validateCsvImportTool, plan);
  return callTool(importTransactionsCsvTool, plan);
}

describe("inspect_csv", () => {
  it("returns only headers, a bounded sample, and the total row count", async () => {
    vi.mocked(extractTextContent).mockResolvedValue(CSV);

    const result = await callTool(inspectCsvTool, { fileKey: "uploads/tx.csv" });

    expect(result.headers).toEqual(["Date", "Libellé", "Montant", "Catégorie"]);
    expect(result.totalRows).toBe(2);
    // The agent must never receive the full data set.
    expect((result.sampleRows as unknown[]).length).toBeLessThanOrEqual(5);
  });

  it("returns a structured error for an unreadable fileKey instead of throwing", async () => {
    vi.mocked(extractTextContent).mockRejectedValue(new Error("NoSuchKey"));

    const result = await callTool(inspectCsvTool, { fileKey: "uploads/missing.csv" });

    expect(result.error).toBe("file_unreadable");
    // The message must tell the agent what to do — not just that it failed.
    expect(result.message).toEqual(expect.stringContaining("fileKey"));
  });

  it("reports a file with no parseable columns", async () => {
    vi.mocked(extractTextContent).mockResolvedValue("");

    const result = await callTool(inspectCsvTool, { fileKey: "uploads/empty.csv" });

    expect(result.error).toBe("no_columns_found");
  });

  // A header-only file is a VALID csv with nothing in it — a different problem from "not a csv",
  // and the user needs a different answer for each.
  it("distinguishes a header-only file from an unparseable one", async () => {
    vi.mocked(extractTextContent).mockResolvedValue("Date,Libellé,Montant");

    const result = await callTool(inspectCsvTool, { fileKey: "uploads/headers-only.csv" });

    expect(result.error).toBe("no_data_rows");
    // The headers parsed fine — report them so the agent can say what the file contained.
    expect(result.headers).toEqual(["Date", "Libellé", "Montant"]);
  });
});

describe("import_transactions_csv", () => {
  it("imports mapped rows and returns a summary only", async () => {
    vi.mocked(extractTextContent).mockResolvedValue(CSV);
    vi.mocked(transactionRepo.importWithCategories).mockResolvedValue({
      imported: 2,
      skipped: 0,
      categorized: 2,
      categoriesCreated: ["Restaurants"],
    });

    const result = await validateThenImport({
      fileKey: "uploads/tx.csv",
      mapping: MAPPING,
      account: "CHECKING",
      dateFormat: "dd/MM/yyyy",
    });

    expect(result).toMatchObject({
      imported: 2,
      categorized: 2,
      uncategorized: 0,
      skippedBadDate: 0,
      categoriesCreated: ["Restaurants"],
    });
    // The row data itself must never come back to the model.
    expect(result.transactions).toBeUndefined();
  });

  /**
   * The v1 category bug: a mapping value that isn't a real header reads as `undefined` for every
   * row, so the field is dropped silently and the user gets a "successful" import missing data.
   */
  it("rejects a mapping that names a column not in the file, importing nothing", async () => {
    vi.mocked(extractTextContent).mockResolvedValue(CSV);

    const result = await validateThenImport({
      fileKey: "uploads/tx.csv",
      mapping: { ...MAPPING, category: "Category" },
      account: "CHECKING",
      dateFormat: "dd/MM/yyyy",
    });

    expect(result.error).toBe("mapping_references_unknown_columns");
    expect(result.unknownColumns).toEqual([{ field: "category", column: "Category" }]);
    // The real headers come back so the agent can correct itself in one step.
    expect(result.availableHeaders).toEqual(expect.arrayContaining(["Catégorie"]));
    expect(transactionRepo.importWithCategories).not.toHaveBeenCalled();
  });

  it("refuses to guess an ambiguous date format, importing nothing", async () => {
    vi.mocked(extractTextContent).mockResolvedValue(CSV);

    const result = await validateThenImport({
      fileKey: "uploads/tx.csv",
      mapping: MAPPING,
      account: "CHECKING",
      // dateFormat deliberately omitted: 05/07/2026 is 5 July or 7 May.
    });

    expect(result.error).toBe("date_format_required");
    expect(result.message).toEqual(expect.stringMatching(/dd\/MM\/yyyy/));
    expect(transactionRepo.importWithCategories).not.toHaveBeenCalled();
  });

  it("reports rows whose date did not match rather than importing them with today's date", async () => {
    const mixed = [
      "Date,Libellé,Montant",
      "2026-07-05,Wrong format,4.50",
      "06/07/2026,Right format,3.20",
    ].join("\n");
    vi.mocked(extractTextContent).mockResolvedValue(mixed);
    vi.mocked(transactionRepo.importWithCategories).mockResolvedValue({
      imported: 1,
      skipped: 0,
      categorized: 0,
      categoriesCreated: [],
    });

    const result = await validateThenImport({
      fileKey: "uploads/tx.csv",
      mapping: { amount: "Montant", note: "Libellé", date: "Date" },
      account: "CHECKING",
      dateFormat: "dd/MM/yyyy",
    });

    expect(result.skippedBadDate).toBe(1);
    expect(result.badDateRows).toEqual([{ row: 1, value: "2026-07-05" }]);
  });

  it("surfaces headers the mapping did not use so nothing is dropped silently", async () => {
    vi.mocked(extractTextContent).mockResolvedValue(CSV);
    vi.mocked(transactionRepo.importWithCategories).mockResolvedValue({
      imported: 2,
      skipped: 0,
      categorized: 0,
      categoriesCreated: [],
    });

    const result = await validateThenImport({
      fileKey: "uploads/tx.csv",
      mapping: { amount: "Montant", note: "Libellé", date: "Date" },
      account: "CHECKING",
      dateFormat: "dd/MM/yyyy",
    });

    expect(result.unmappedHeaders).toEqual(["Catégorie"]);
  });
});

describe("validate_csv_import", () => {
  it("reports what would import without writing anything", async () => {
    vi.mocked(extractTextContent).mockResolvedValue(CSV);

    const result = await callTool(validateCsvImportTool, {
      fileKey: "uploads/tx.csv",
      mapping: MAPPING,
      account: "CHECKING",
      dateFormat: "dd/MM/yyyy",
    });

    expect(result).toMatchObject({ ok: true, validated: true, wouldImport: 2, total: 2 });
    // The whole point: validation must not touch the ledger.
    expect(transactionRepo.importWithCategories).not.toHaveBeenCalled();
  });

  // A few refused rows and a mostly-refused file need OPPOSITE responses: recover row by row, or
  // fix the mapping. Conflating them is what turns a few bad rows into a duplicating re-import.
  it("steers a mostly-refused file toward fixing the mapping", async () => {
    const mostlyBad = [
      "Date,Libellé,Montant",
      ...Array.from({ length: 5 }, (_, i) => `2026-07-0${i + 1},Wrong shape,1.00`),
      "06/07/2026,Right,3.20",
    ].join("\n");
    vi.mocked(extractTextContent).mockResolvedValue(mostlyBad);

    const result = await callTool(validateCsvImportTool, {
      fileKey: "uploads/tx.csv",
      mapping: { amount: "Montant", note: "Libellé", date: "Date" },
      account: "CHECKING",
      dateFormat: "dd/MM/yyyy",
    });

    expect(result.wouldImport).toBe(1);
    expect(result.skippedBadDate).toBe(5);
    expect(result.hint).toEqual(expect.stringContaining("mapping or dateFormat is probably wrong"));
  });

  it("tells the agent to recover a few refused rows individually, not by re-importing", async () => {
    const mixed = [
      "Date,Libellé,Montant",
      "2026-07-05,Wrong shape,4.50",
      ...Array.from({ length: 4 }, (_, i) => `0${i + 1}/07/2026,Fine,1.00`),
    ].join("\n");
    vi.mocked(extractTextContent).mockResolvedValue(mixed);

    const result = await callTool(validateCsvImportTool, {
      fileKey: "uploads/tx.csv",
      mapping: { amount: "Montant", note: "Libellé", date: "Date" },
      account: "CHECKING",
      dateFormat: "dd/MM/yyyy",
    });

    expect(result.hint).toEqual(expect.stringContaining("read_csv_rows"));
    expect(result.hint).toEqual(expect.stringContaining("Do NOT re-import"));
  });

  it("returns the same counts the real import then produces", async () => {
    vi.mocked(extractTextContent).mockResolvedValue(CSV);
    vi.mocked(transactionRepo.importWithCategories).mockResolvedValue({
      imported: 2,
      skipped: 0,
      categorized: 2,
      categoriesCreated: [],
    });
    const plan = {
      fileKey: "uploads/tx.csv",
      mapping: MAPPING,
      account: "CHECKING",
      dateFormat: "dd/MM/yyyy",
    };

    const validated = await callTool(validateCsvImportTool, plan);
    const imported = await callTool(importTransactionsCsvTool, plan);

    expect(validated.wouldImport).toBe(imported.imported);
    expect(validated.total).toBe(imported.total);
    expect(validated.skippedBadDate).toBe(imported.skippedBadDate);
  });
});

describe("import_transactions_csv — the validation gate", () => {
  // `validatedPlans` is module-level and survives between calls, so this block needs a fileKey no
  // other test has validated — otherwise the gate looks satisfied when nothing here validated it.
  const PLAN = {
    fileKey: "uploads/gate-only.csv",
    mapping: MAPPING,
    account: "CHECKING",
    dateFormat: "dd/MM/yyyy",
  };

  it("refuses a plan that was never validated, writing nothing", async () => {
    vi.mocked(extractTextContent).mockResolvedValue(CSV);
    // Mocked so the assertion proves the GATE stopped the write, not that the write crashed.
    vi.mocked(transactionRepo.importWithCategories).mockResolvedValue({
      imported: 2,
      skipped: 0,
      categorized: 0,
      categoriesCreated: [],
    });

    const result = await callTool(importTransactionsCsvTool, PLAN);

    expect(result.error).toBe("validation_required");
    expect(transactionRepo.importWithCategories).not.toHaveBeenCalled();
  });

  // A gate keyed on fileKey alone would wave through a retry that changed only the date format —
  // which is exactly how a re-import duplicates everything that already landed.
  it("refuses when any argument changed since validation — including dateFormat", async () => {
    vi.mocked(extractTextContent).mockResolvedValue(CSV);
    vi.mocked(transactionRepo.importWithCategories).mockResolvedValue({
      imported: 2,
      skipped: 0,
      categorized: 0,
      categoriesCreated: [],
    });
    await callTool(validateCsvImportTool, PLAN);

    const result = await callTool(importTransactionsCsvTool, {
      ...PLAN,
      dateFormat: "dd/MM/yyyy HH:mm:ss",
    });

    expect(result.error).toBe("validation_required");
    expect(transactionRepo.importWithCategories).not.toHaveBeenCalled();
  });

  it("accepts a validated plan", async () => {
    vi.mocked(extractTextContent).mockResolvedValue(CSV);
    vi.mocked(transactionRepo.importWithCategories).mockResolvedValue({
      imported: 2,
      skipped: 0,
      categorized: 0,
      categoriesCreated: [],
    });
    await callTool(validateCsvImportTool, PLAN);

    expect((await callTool(importTransactionsCsvTool, PLAN)).imported).toBe(2);
  });
});

describe("import_transactions_csv — duplicate honesty", () => {
  const basePlan = {
    fileKey: "uploads/tx.csv",
    account: "CHECKING",
    dateFormat: "dd/MM/yyyy",
  };

  beforeEach(() => {
    vi.mocked(extractTextContent).mockResolvedValue(CSV);
    vi.mocked(transactionRepo.importWithCategories).mockResolvedValue({
      imported: 2,
      skipped: 0,
      categorized: 0,
      categoriesCreated: [],
    });
  });

  // Dedup keys on (source, externalId) and NULL never equals NULL in Postgres, so with no id
  // column nothing is deduplicated. A `skippedDuplicates: 0` would read as "checked, none found".
  it("says duplicate detection is UNAVAILABLE when no externalId is mapped", async () => {
    const result = await validateThenImport({ ...basePlan, mapping: MAPPING });

    expect(result.duplicateDetection).toBe("unavailable");
    expect(result.skippedDuplicates).toBeUndefined();
    expect(result.duplicateWarning).toEqual(expect.stringContaining("SECOND copy"));
  });

  it("reports detection as active when the file has a unique id column", async () => {
    const withId = [
      "Date,Libellé,Montant,Ref",
      "05/07/2026,Café du coin,4.50,tx-1",
      "06/07/2026,Boulangerie,3.20,tx-2",
    ].join("\n");
    vi.mocked(extractTextContent).mockResolvedValue(withId);

    const result = await validateThenImport({
      ...basePlan,
      mapping: { amount: "Montant", note: "Libellé", date: "Date", externalId: "Ref" },
    });

    expect(result.duplicateDetection).toBe("active");
    expect(result.duplicateWarning).toBeUndefined();
  });
});

describe("read_csv_rows", () => {
  const CSV6 = [
    "Date,Libellé,Montant",
    ...Array.from({ length: 6 }, (_, i) => `0${i + 1}/09/2026,Row ${i + 1},${i + 1}.00`),
  ].join("\n");

  it("returns the requested rows raw, each tagged with its number", async () => {
    vi.mocked(extractTextContent).mockResolvedValue(CSV6);

    const result = await callTool(readCsvRowsTool, { fileKey: "uploads/tx.csv", rows: [2, 4] });

    expect(result.rows).toEqual([
      { row: 2, data: { Date: "02/09/2026", Libellé: "Row 2", Montant: "2.00" } },
      { row: 4, data: { Date: "04/09/2026", Libellé: "Row 4", Montant: "4.00" } },
    ]);
  });

  it("supports a contiguous range", async () => {
    vi.mocked(extractTextContent).mockResolvedValue(CSV6);

    const result = await callTool(readCsvRowsTool, {
      fileKey: "uploads/tx.csv",
      start: 2,
      end: 3,
    });

    expect((result.rows as { row: number }[]).map((r) => r.row)).toEqual([2, 3]);
  });

  it("reports row numbers outside the file rather than returning nothing", async () => {
    vi.mocked(extractTextContent).mockResolvedValue(CSV6);

    const result = await callTool(readCsvRowsTool, { fileKey: "uploads/tx.csv", rows: [99] });

    expect(result.missing).toEqual([99]);
    expect(result.totalRows).toBe(6);
    expect(result.hint_missing).toEqual(expect.stringContaining("1-based"));
  });

  it("asks for a row selection instead of dumping the file", async () => {
    vi.mocked(extractTextContent).mockResolvedValue(CSV6);

    const result = await callTool(readCsvRowsTool, { fileKey: "uploads/tx.csv" });

    expect(result.error).toBe("no_rows_requested");
  });
});
