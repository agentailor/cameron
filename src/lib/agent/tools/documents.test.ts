import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { DocumentReading } from "@/lib/documents/reading";
import { callTool } from "./testing";

const getFileWithType = vi.fn();
vi.mock("@/lib/storage/upload", () => ({
  getFileWithType: (key: string) => getFileWithType(key),
}));

const getByHash = vi.fn();
const create = vi.fn();
vi.mock("@/lib/repositories/documentRepository", () => ({
  getByHash: (h: string) => getByHash(h),
  create: (d: unknown) => create(d),
}));

const { createDocumentTools, MAX_TEXT_CHARS } = await import("./documents");

const READING: DocumentReading = {
  kind: "receipt",
  summary: "Receipt from CORNER BISTRO",
  text: "CORNER BISTRO\nTOTAL EUR 47.35",
  fields: {
    merchant: "CORNER BISTRO",
    date: "14/03/2026",
    total: 47.35,
    subtotal: 38.5,
    tax: 3.85,
    tip: 5,
    currency: "EUR",
    unreadable: [],
  },
};
const BYTES = Buffer.from("png-bytes");
const HASH = createHash("sha256").update(BYTES).digest("hex");

/**
 * A stand-in chat model: records what it was sent and returns what the test says. The structured
 * call returns `{ raw, parsed }` as `includeRaw` does; `structured` gives the parsed value, and a
 * test can hand back a raw message instead via `returnsRaw`.
 */
function fakeModel() {
  const calls: { kind: "structured" | "plain"; messages: BaseMessage[]; options: any }[] = [];
  let structured: () => unknown = () => READING;
  let plain: () => unknown = () => ({ text: "an answer" });
  const model = {
    withStructuredOutput: () => ({
      invoke: async (messages: BaseMessage[], options: unknown) => {
        calls.push({ kind: "structured", messages, options });
        const value = structured();
        return value instanceof AIMessage
          ? { raw: value, parsed: null }
          : { raw: new AIMessage(JSON.stringify(value)), parsed: value };
      },
    }),
    invoke: async (messages: BaseMessage[], options: unknown) => {
      calls.push({ kind: "plain", messages, options });
      return plain();
    },
  };
  return {
    model,
    calls,
    returns: (fn: () => unknown) => (structured = fn),
    answers: (fn: () => unknown) => (plain = fn),
  };
}

let fake: ReturnType<typeof fakeModel>;
const read = (input: Record<string, unknown>) => {
  const [tool] = createDocumentTools({ model: fake.model as never, readWith: "openai:test-model" });
  return callTool(tool, input);
};

/** The non-text block of the document message the model was sent. */
const sentBlock = (i = 0) =>
  (fake.calls[i].messages[1].content as any[]).find((b) => b.type !== "text");

beforeEach(() => {
  fake = fakeModel();
  getFileWithType.mockReset().mockResolvedValue({ buffer: BYTES, contentType: "image/png" });
  getByHash.mockReset().mockResolvedValue(null);
  create.mockReset().mockImplementation(async (d: any) => ({ id: "doc-1", ...d }));
});

describe("read_document — a new file", () => {
  it("reads it, stores the reading by content hash, and returns it", async () => {
    const out = await read({ fileKey: "k.png" });

    expect(out).toMatchObject({
      ok: true,
      documentId: "doc-1",
      kind: "receipt",
      fields: { total: 47.35, currency: "EUR", unreadable: [] },
      truncated: false,
    });
    expect(out.readBefore).toBeUndefined();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        fileKey: "k.png",
        contentHash: HASH,
        mimeType: "image/png",
        readWith: "openai:test-model",
      }),
    );
  });

  it("sends an image as a standard image block with its bytes and a filename", async () => {
    await read({ fileKey: "k.png" });
    expect(sentBlock()).toMatchObject({
      type: "image",
      data: BYTES.toString("base64"),
      mimeType: "image/png",
      metadata: { filename: "k.png" },
    });
  });

  // The bug the live check found: inside the agent graph the reply is in LangChain's "v1" output
  // format, the parser reads its array content as no text, and the JSON is only in the blocks.
  it("takes the reading from v1 array content when the parser comes back empty", async () => {
    fake.returns(
      () => new AIMessage({ content: [{ type: "text", text: JSON.stringify(READING) }] }),
    );
    const out = await read({ fileKey: "k.png" });
    expect(out).toMatchObject({ ok: true, fields: { total: 47.35 } });
  });

  it("strips a json fence from a text reply", async () => {
    const fenced = ["```json", JSON.stringify(READING), "```"].join(String.fromCharCode(10));
    fake.returns(() => new AIMessage(fenced));
    expect((await read({ fileKey: "k.png" })).fields.total).toBe(47.35);
  });

  it("sends a PDF as a file block", async () => {
    getFileWithType.mockResolvedValue({ buffer: BYTES, contentType: "application/pdf" });
    await read({ fileKey: "k.pdf" });
    expect(sentBlock()).toMatchObject({ type: "file", mimeType: "application/pdf" });
  });

  // Without it, LangGraph streams the reader's output into the chat as the agent's own words.
  it("tags the vision call nostream", async () => {
    await read({ fileKey: "k.png" });
    expect(fake.calls[0].options.tags).toContain("nostream");
  });

  it("answers a question in the same call", async () => {
    fake.returns(() => ({ ...READING, answer: "5.00" }));
    const out = await read({ fileKey: "k.png", question: "How much was the tip?" });
    expect(out.answer).toBe("5.00");
    expect(fake.calls).toHaveLength(1);
    expect(create.mock.calls[0][0].reading).not.toHaveProperty("answer");
  });

  it("never returns a value the reader called unreadable", async () => {
    fake.returns(() => ({
      ...READING,
      fields: { ...READING.fields, total: 47.35, unreadable: ["total"] },
    }));
    const out = await read({ fileKey: "k.png" });
    expect(out.fields.total).toBeNull();
    expect(out.fields.unreadable).toEqual(["total"]);
  });

  it("omits fields for a document that is not a receipt or invoice", async () => {
    fake.returns(() => ({ ...READING, kind: "other" }));
    const out = await read({ fileKey: "k.png" });
    expect(out.kind).toBe("other");
    expect(out).not.toHaveProperty("fields");
  });

  it("cuts a long transcription visibly", async () => {
    const text = "x".repeat(MAX_TEXT_CHARS + 50);
    fake.returns(() => ({ ...READING, text }));
    const out = await read({ fileKey: "k.png" });
    expect(out.truncated).toBe(true);
    expect(out.textLength).toBe(text.length);
    expect(out.text).toHaveLength(MAX_TEXT_CHARS);
    // The stored reading keeps all of it.
    expect(create.mock.calls[0][0].reading.text).toBe(text);
  });
});

describe("read_document — a file already read", () => {
  beforeEach(() => {
    getByHash.mockResolvedValue({ id: "doc-0", fileKey: "first.png", reading: READING });
  });

  it("returns the stored reading without calling the model", async () => {
    const out = await read({ fileKey: "again.png" });
    expect(out).toMatchObject({ ok: true, documentId: "doc-0", readBefore: true });
    expect(fake.calls).toHaveLength(0);
    expect(create).not.toHaveBeenCalled();
  });

  it("spends one plain call on a question and stores nothing", async () => {
    const out = await read({ fileKey: "again.png", question: "Is it stamped paid?" });
    expect(out.answer).toBe("an answer");
    expect(fake.calls.map((c) => c.kind)).toEqual(["plain"]);
    expect(fake.calls[0].options.tags).toContain("nostream");
    expect(create).not.toHaveBeenCalled();
  });
});

describe("read_document — failures come back as payloads", () => {
  it("file_unreadable when storage has no such key", async () => {
    getFileWithType.mockRejectedValue(new Error("NoSuchKey"));
    const out = await read({ fileKey: "made-up.png" });
    expect(out.error).toBe("file_unreadable");
    expect(out.message).toContain("never invent one");
  });

  it("unsupported_type for a CSV, pointing at inspect_csv, without a model call", async () => {
    getFileWithType.mockResolvedValue({ buffer: BYTES, contentType: "text/csv" });
    const out = await read({ fileKey: "k.csv" });
    expect(out.error).toBe("unsupported_type");
    expect(out.message).toContain("inspect_csv");
    expect(fake.calls).toHaveLength(0);
  });

  const failWith = (name: string, message = "boom") =>
    fake.returns(() => {
      const err = new Error(message);
      err.name = name;
      throw err;
    });

  it("timeout", async () => {
    failWith("TimeoutError");
    expect((await read({ fileKey: "k.png" })).error).toBe("timeout");
  });

  it("invalid_reading when the reply is not JSON", async () => {
    fake.returns(() => new AIMessage("I can see a receipt from a bistro."));
    const out = await read({ fileKey: "k.png" });
    expect(out.error).toBe("invalid_reading");
    expect(create).not.toHaveBeenCalled();
  });

  it("invalid_reading when the JSON does not fit the schema", async () => {
    fake.returns(() => new AIMessage(JSON.stringify({ kind: "napkin" })));
    expect((await read({ fileKey: "k.png" })).error).toBe("invalid_reading");
  });

  it("invalid_reading for LangChain's own parse failure", async () => {
    fake.returns(() => {
      throw Object.assign(new Error("Failed to parse"), {
        lc_error_code: "OUTPUT_PARSING_FAILURE",
      });
    });
    expect((await read({ fileKey: "k.png" })).error).toBe("invalid_reading");
  });

  it("model_cannot_read names the model and quotes the provider, and stores nothing", async () => {
    failWith("BadRequestError", "400 image input is not supported for this model");
    const out = await read({ fileKey: "k.png" });
    expect(out.error).toBe("model_cannot_read");
    expect(out.message).toContain("openai:test-model");
    expect(out.message).toContain("image input is not supported");
    expect(create).not.toHaveBeenCalled();
  });
});
