import { describe, expect, it } from "vitest";
import {
  inspectCsv,
  mapCsvToTransactions,
  unmappedHeaders,
  validateMapping,
  type ColumnMapping,
} from "./csv";
import { Account, TransactionType } from "@/types/finance";

/**
 * CSV mapping internals — pure functions, no storage and no DB. These cover the data-loss
 * failure modes the import tool is built to refuse: a mapped column that isn't a real header,
 * and an ambiguous date format. Both must fail loudly rather than silently dropping data.
 */

const CSV = [
  "Date,Libellé,Montant,Catégorie,Revenu/dépense",
  "05/07/2026,Café du coin,4.50,Restaurants,dépense",
  "12/07/2026,Salaire,2500.00,Revenus,revenu",
].join("\n");

const MAPPING: ColumnMapping = {
  amount: "Montant",
  note: "Libellé",
  date: "Date",
  category: "Catégorie",
  type: "Revenu/dépense",
};

const BASE_OPTS = {
  mapping: MAPPING,
  account: Account.CHECKING,
  typeValues: { expense: ["dépense"], income: ["revenu"] },
};

describe("inspectCsv", () => {
  it("returns headers, a bounded sample, and the true total", () => {
    const preview = inspectCsv(CSV, 1);
    expect(preview.headers).toEqual(["Date", "Libellé", "Montant", "Catégorie", "Revenu/dépense"]);
    // The sample is capped but the count reflects the whole file — the agent needs to know
    // how much it is NOT seeing.
    expect(preview.sampleRows).toHaveLength(1);
    expect(preview.totalRows).toBe(2);
  });

  it("handles an empty file without throwing", () => {
    expect(inspectCsv("")).toMatchObject({ headers: [], sampleRows: [], totalRows: 0 });
  });

  // Headers come from the parsed header row, not from the first record — so a header-only file
  // still reports its columns instead of looking identical to a non-CSV.
  it("reports headers for a file with a header row but no data", () => {
    expect(inspectCsv("Date,Libellé,Montant")).toMatchObject({
      headers: ["Date", "Libellé", "Montant"],
      sampleRows: [],
      totalRows: 0,
    });
  });
});

describe("validateMapping", () => {
  it("passes when every mapped column is a real header", () => {
    const { unknownColumns } = validateMapping(inspectCsv(CSV).headers, MAPPING);
    expect(unknownColumns).toEqual([]);
  });

  it("flags a translated/normalized header that is not in the file", () => {
    // The v1 category bug: "Category" is not "Catégorie", so every row's category read as
    // undefined and was dropped silently.
    const { unknownColumns } = validateMapping(inspectCsv(CSV).headers, {
      ...MAPPING,
      category: "Category",
    });
    expect(unknownColumns).toEqual([{ field: "category", column: "Category" }]);
  });
});

describe("unmappedHeaders", () => {
  it("reports headers the mapping did not use", () => {
    const mapping: ColumnMapping = { amount: "Montant", note: "Libellé" };
    expect(unmappedHeaders(inspectCsv(CSV).headers, mapping)).toEqual([
      "Date",
      "Catégorie",
      "Revenu/dépense",
    ]);
  });

  it("returns nothing when every header is mapped", () => {
    expect(unmappedHeaders(inspectCsv(CSV).headers, MAPPING)).toEqual([]);
  });
});

describe("mapCsvToTransactions", () => {
  it("maps rows with the declared date format", () => {
    const { rows, skipped, badDateRows } = mapCsvToTransactions(CSV, {
      ...BASE_OPTS,
      dateFormat: "dd/MM/yyyy",
    });

    expect(skipped).toBe(0);
    expect(badDateRows).toEqual([]);
    expect(rows).toHaveLength(2);

    // Amounts become always-positive minor units; direction lives in `type`.
    expect(rows[0]).toMatchObject({
      amountMinor: 450,
      type: TransactionType.expense,
      note: "Café du coin",
      categoryName: "Restaurants",
      account: Account.CHECKING,
      source: "csv",
    });
    expect(rows[1]).toMatchObject({ amountMinor: 250000, type: TransactionType.income });
  });

  // The ambiguity the import tool refuses to guess at: 05/07/2026 is 5 July or 7 May
  // depending entirely on the declared format. Getting this wrong silently books
  // transactions on the wrong date, so the format must actually drive parsing.
  it("interprets the same value differently under dd/MM/yyyy vs MM/dd/yyyy", () => {
    const asDMY = mapCsvToTransactions(CSV, { ...BASE_OPTS, dateFormat: "dd/MM/yyyy" });
    const asMDY = mapCsvToTransactions(CSV, { ...BASE_OPTS, dateFormat: "MM/dd/yyyy" });

    expect(asDMY.rows[0].occurredAt).toBeInstanceOf(Date);
    const dmy = asDMY.rows[0].occurredAt as Date;
    const mdy = asMDY.rows[0].occurredAt as Date;

    // 5 July vs 7 May — same input, different month.
    expect(dmy.getUTCMonth()).toBe(6);
    expect(dmy.getUTCDate()).toBe(5);
    expect(mdy.getUTCMonth()).toBe(4);
    expect(mdy.getUTCDate()).toBe(7);
  });

  it("preserves the file's calendar day regardless of server timezone", () => {
    const { rows } = mapCsvToTransactions(CSV, { ...BASE_OPTS, dateFormat: "dd/MM/yyyy" });
    // Parsed wall-clock is reinterpreted as UTC, so the stored day matches the file.
    expect((rows[0].occurredAt as Date).toISOString().slice(0, 10)).toBe("2026-07-05");
  });

  // The regression this exists to prevent: a row whose date doesn't match the declared format
  // must be REPORTED, never imported with today's date.
  it("collects unparseable dates instead of defaulting them to now()", () => {
    const csv = ["Date,Libellé,Montant", "2026-07-05,Bad format,4.50", "06/07/2026,Good,1.00"].join(
      "\n",
    );

    const { rows, badDateRows } = mapCsvToTransactions(csv, {
      mapping: { amount: "Montant", note: "Libellé", date: "Date" },
      account: Account.CHECKING,
      dateFormat: "dd/MM/yyyy",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].note).toBe("Good");
    // 1-based row number so a human can find it in the file, plus the offending value.
    expect(badDateRows).toEqual([{ row: 1, value: "2026-07-05" }]);
  });

  it("treats every dated row as bad when no dateFormat is supplied", () => {
    const { rows, badDateRows } = mapCsvToTransactions(CSV, BASE_OPTS);
    expect(rows).toHaveLength(0);
    expect(badDateRows).toHaveLength(2);
  });

  it("skips rows with an unparseable amount or a missing note", () => {
    const csv = ["Libellé,Montant", "No amount,abc", ",12.00", "Fine,3.00"].join("\n");
    const { rows, skipped } = mapCsvToTransactions(csv, {
      mapping: { amount: "Montant", note: "Libellé" },
      account: Account.CHECKING,
    });
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  it("falls back to typeDefault when the type value is unrecognized", () => {
    const csv = ["Libellé,Montant,Type", "Mystery,5.00,inconnu"].join("\n");
    const { rows } = mapCsvToTransactions(csv, {
      mapping: { amount: "Montant", note: "Libellé", type: "Type" },
      account: Account.CHECKING,
      typeDefault: TransactionType.income,
      typeValues: { expense: ["dépense"], income: ["revenu"] },
    });
    expect(rows[0].type).toBe(TransactionType.income);
  });
});
