import { describe, expect, it } from "vitest";
import {
  dateFormatWithoutTime,
  inspectCsv,
  mapCsvToTransactions,
  readCsvRows,
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
    const { rows, unparsableRows, badDateRows } = mapCsvToTransactions(CSV, {
      ...BASE_OPTS,
      dateFormat: "dd/MM/yyyy",
    });

    expect(unparsableRows).toEqual([]);
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

  // A bare count leaves the row unrecoverable — the number and reason are what make it fixable.
  it("reports rows with an unparseable amount or a missing note by row number", () => {
    const csv = ["Libellé,Montant", "No amount,abc", ",12.00", "Fine,3.00"].join("\n");
    const { rows, unparsableRows } = mapCsvToTransactions(csv, {
      mapping: { amount: "Montant", note: "Libellé" },
      account: Account.CHECKING,
    });
    expect(rows).toHaveLength(1);
    expect(unparsableRows).toEqual([
      { row: 1, reason: "amount_unparseable" },
      { row: 2, reason: "note_missing" },
    ]);
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

describe("dateFormatWithoutTime", () => {
  it("strips the time part and trailing separators", () => {
    expect(dateFormatWithoutTime("dd/MM/yyyy HH:mm:ss")).toBe("dd/MM/yyyy");
    expect(dateFormatWithoutTime("yyyy-MM-dd'T'HH:mm")).toBe("yyyy-MM-dd");
    expect(dateFormatWithoutTime("MM/dd/yyyy h:mm a")).toBe("MM/dd/yyyy");
  });

  it("returns null when there is no time part to strip", () => {
    expect(dateFormatWithoutTime("dd/MM/yyyy")).toBeNull();
    expect(dateFormatWithoutTime("yyyy-MM-dd")).toBeNull();
  });
});

/**
 * A file may mix "06/09/2026 22:41:15" with a bare "07/09/2026". Under one declared format the
 * other shape used to be refused, and re-importing to rescue it duplicates everything that already
 * landed — so both shapes must import in ONE pass.
 */
describe("mapCsvToTransactions — dates without a time", () => {
  const MIXED = [
    "Date,Libellé,Montant",
    "06/09/2026 22:41:15,With time,10.00",
    "07/09/2026,Without time,20.00",
  ].join("\n");

  const OPTS = {
    mapping: { amount: "Montant", note: "Libellé", date: "Date" },
    account: Account.CHECKING,
    dateFormat: "dd/MM/yyyy HH:mm:ss",
  };

  it("imports a row whose value omits the time, at midnight", () => {
    const { rows, badDateRows, datesWithoutTime } = mapCsvToTransactions(MIXED, OPTS);

    expect(badDateRows).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(datesWithoutTime).toBe(1);

    const withTime = rows[0].occurredAt as Date;
    expect(withTime.toISOString()).toBe("2026-09-06T22:41:15.000Z");
    // Time defaulted to 00:00:00 — never to "now", and never to the reference date's time.
    const withoutTime = rows[1].occurredAt as Date;
    expect(withoutTime.toISOString()).toBe("2026-09-07T00:00:00.000Z");
  });

  // Truncation may only drop precision, never reinterpret field order — that is the DD/MM-vs-MM/DD
  // ambiguity parseDate refuses to guess at.
  it("keeps the declared field order when falling back to date-only", () => {
    const { rows } = mapCsvToTransactions(MIXED, { ...OPTS, dateFormat: "MM/dd/yyyy HH:mm:ss" });
    const asMDY = rows[1].occurredAt as Date;
    expect(asMDY.getUTCMonth()).toBe(6); // July, not September
    expect(asMDY.getUTCDate()).toBe(9);
  });

  it("still refuses a value that matches neither the full nor the date-only format", () => {
    const csv = ["Date,Libellé,Montant", "2026-09-07,Wrong shape,5.00"].join("\n");
    const { rows, badDateRows, datesWithoutTime } = mapCsvToTransactions(csv, OPTS);
    expect(rows).toHaveLength(0);
    expect(datesWithoutTime).toBe(0);
    expect(badDateRows).toEqual([{ row: 1, value: "2026-09-07" }]);
  });
});

describe("readCsvRows", () => {
  const CSV6 = [
    "Date,Libellé,Montant",
    ...Array.from({ length: 6 }, (_, i) => `0${i + 1}/09/2026,Row ${i + 1},${i + 1}.00`),
  ].join("\n");

  // Row 1 is the first DATA row, matching badDateRows. An off-by-one makes the agent "correct" a
  // neighbouring transaction.
  it("reads rows by 1-based data-row number, echoing each number back", () => {
    const { rows } = readCsvRows(CSV6, [1, 3], 25);
    expect(rows).toEqual([
      { row: 1, data: { Date: "01/09/2026", Libellé: "Row 1", Montant: "1.00" } },
      { row: 3, data: { Date: "03/09/2026", Libellé: "Row 3", Montant: "3.00" } },
    ]);
  });

  it("agrees with the row numbers mapCsvToTransactions refused", () => {
    const csv = [
      "Date,Libellé,Montant",
      "01/09/2026,Good,1.00",
      "nonsense,Bad date,2.00",
      "03/09/2026,Also good,3.00",
    ].join("\n");
    const { badDateRows } = mapCsvToTransactions(csv, {
      mapping: { amount: "Montant", note: "Libellé", date: "Date" },
      account: Account.CHECKING,
      dateFormat: "dd/MM/yyyy",
    });

    const { rows } = readCsvRows(
      csv,
      badDateRows.map((r) => r.row),
      25,
    );
    expect(rows[0].data["Libellé"]).toBe("Bad date");
  });

  it("sorts and de-duplicates the requested numbers", () => {
    const { rows } = readCsvRows(CSV6, [3, 1, 3], 25);
    expect(rows.map((r) => r.row)).toEqual([1, 3]);
  });

  it("reports out-of-range numbers as missing instead of dropping them", () => {
    const { rows, missing, totalRows } = readCsvRows(CSV6, [2, 99], 25);
    expect(rows.map((r) => r.row)).toEqual([2]);
    expect(missing).toEqual([99]);
    expect(totalRows).toBe(6);
  });

  it("bounds the page and says so", () => {
    const { rows, truncated } = readCsvRows(CSV6, [1, 2, 3, 4, 5, 6], 2);
    expect(rows).toHaveLength(2);
    expect(truncated).toBe(true);
  });
});
