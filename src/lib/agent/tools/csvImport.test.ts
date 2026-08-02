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
const { inspectCsvTool, importTransactionsCsvTool } = await import("./csvImport");

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

    const result = await callTool(importTransactionsCsvTool, {
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

    const result = await callTool(importTransactionsCsvTool, {
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

    const result = await callTool(importTransactionsCsvTool, {
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

    const result = await callTool(importTransactionsCsvTool, {
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

    const result = await callTool(importTransactionsCsvTool, {
      fileKey: "uploads/tx.csv",
      mapping: { amount: "Montant", note: "Libellé", date: "Date" },
      account: "CHECKING",
      dateFormat: "dd/MM/yyyy",
    });

    expect(result.unmappedHeaders).toEqual(["Catégorie"]);
  });
});
