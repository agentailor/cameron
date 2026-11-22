import { describe, expect, it } from "vitest";
import { linkDocumentReadings } from "./documentPreview";

const result = (payload: unknown) => ({ data: { content: JSON.stringify(payload) } });
const READING = { ok: true, kind: "receipt", fields: { total: 47.35 } };

const read = (fileKey: string, payload: unknown) => ({
  name: "read_document",
  args: { fileKey },
  result: result(payload),
});
const log = (fileKey: string) => ({
  name: "log_from_document",
  args: { fileKey, amount: 47.35 },
  result: null,
  preview: undefined as Record<string, unknown> | null | undefined,
});

describe("linkDocumentReadings", () => {
  it("gives a log the earlier reading of the same file", () => {
    const l = log("a.png");
    linkDocumentReadings([read("a.png", READING), l]);
    expect(l.preview).toEqual(READING);
  });

  it("never pairs across files", () => {
    const l = log("a.png");
    linkDocumentReadings([read("b.png", READING), l]);
    expect(l.preview).toBeNull();
  });

  // The server returns it as an error payload, with nothing from the document in it.
  it("never pairs a withheld document", () => {
    const l = log("a.png");
    linkDocumentReadings([read("a.png", { error: "untrusted_document", message: "…" }), l]);
    expect(l.preview).toBeNull();
  });

  it("ignores a reading that came after the log", () => {
    const l = log("a.png");
    linkDocumentReadings([l, read("a.png", READING)]);
    expect(l.preview).toBeNull();
  });
});
