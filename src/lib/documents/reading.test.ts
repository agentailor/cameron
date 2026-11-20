import { describe, expect, it } from "vitest";
import { normalizeReading, type DocumentReading } from "./reading";

const receipt = (fields: Partial<NonNullable<DocumentReading["fields"]>>): DocumentReading => ({
  kind: "receipt",
  summary: "s",
  text: "t",
  fields: {
    merchant: "M",
    date: "14/03/2026",
    total: 47.35,
    subtotal: 38.5,
    tax: 3.85,
    tip: 5,
    currency: "EUR",
    unreadable: [],
    ...fields,
  },
});

describe("normalizeReading", () => {
  // The defect this exists for: a value beside "unreadable" is a guess the agent would log.
  it("drops any value the reader also called unreadable", () => {
    const out = normalizeReading(receipt({ total: 47.35, unreadable: ["total"] }));
    expect(out.fields?.total).toBeNull();
    expect(out.fields?.unreadable).toEqual(["total"]);
    expect(out.fields?.subtotal).toBe(38.5);
  });

  it("dedupes unreadable", () => {
    expect(normalizeReading(receipt({ unreadable: ["tip", "tip"] })).fields?.unreadable).toEqual([
      "tip",
    ]);
  });

  it("strips fields from a document that is not a receipt or invoice", () => {
    expect(normalizeReading({ ...receipt({}), kind: "other" }).fields).toBeNull();
  });

  it("leaves a clean reading as it was", () => {
    const r = receipt({});
    expect(normalizeReading(r)).toEqual(r);
  });
});
