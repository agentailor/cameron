import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { CallbackManager } from "@langchain/core/callbacks/manager";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { AsyncLocalStorageProviderSingleton } from "@langchain/core/singletons";
import type { DocumentReading } from "@/lib/documents/reading";
import { GenAiTracer } from "@/lib/tracing/genAiTracer";
import { callTool } from "./testing";

const getFileWithType = vi.fn();
vi.mock("@/lib/storage/upload", () => ({
  getFileWithType: (key: string) => getFileWithType(key),
}));

const { createDocumentTools } = await import("./documents");

const READING: DocumentReading = {
  kind: "receipt",
  summary: "Receipt from CORNER BISTRO",
  language: "fr",
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

interface Call {
  messages: BaseMessage[];
  options: any;
  /** The LangChain context the model ran in — must be empty: see vision.ts `outsideGraph`. */
  inheritedStore: unknown;
}

/**
 * A stand-in chat model that answers like `withStructuredOutput(…, { includeRaw: true })`:
 * `{ raw, parsed }`. `returns` sets the parsed reading; `replies` sets the raw message instead.
 */
function fakeModel() {
  const calls: Call[] = [];
  let parsed: () => unknown = () => READING;
  let raw: () => AIMessage = () => new AIMessage("{}");
  const model = {
    withStructuredOutput: () => ({
      invoke: async (messages: BaseMessage[], options: unknown) => {
        calls.push({
          messages,
          options,
          inheritedStore: AsyncLocalStorageProviderSingleton.getInstance().getStore(),
        });
        const p = parsed();
        return { raw: raw(), parsed: p, ...(p ? {} : { parsingError: new SyntaxError("bad") }) };
      },
    }),
  };
  return {
    model,
    calls,
    returns: (fn: () => unknown) => (parsed = fn),
    replies: (fn: () => AIMessage) => (raw = fn),
  };
}

let fake: ReturnType<typeof fakeModel>;
const tools = () =>
  createDocumentTools({ model: fake.model as never, readWith: "openai:test-model" });
const read = (input: Record<string, unknown>) => callTool(tools()[0], input);

/** The non-text block of the document message the model was sent. */
const sentBlock = () => (fake.calls[0].messages[1].content as any[]).find((b) => b.type !== "text");

beforeEach(() => {
  fake = fakeModel();
  getFileWithType.mockReset().mockResolvedValue({ buffer: BYTES, contentType: "image/png" });
});

describe("read_document — reading", () => {
  it("returns the reading", async () => {
    expect(await read({ fileKey: "k.png" })).toEqual({
      ok: true,
      kind: "receipt",
      summary: READING.summary,
      language: "fr",
      fields: READING.fields,
      text: READING.text,
    });
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

  it("sends a PDF as a file block", async () => {
    getFileWithType.mockResolvedValue({ buffer: BYTES, contentType: "application/pdf" });
    await read({ fileKey: "k.pdf" });
    expect(sentBlock()).toMatchObject({ type: "file", mimeType: "application/pdf" });
  });

  it("answers a question in the same read", async () => {
    fake.returns(() => ({ ...READING, answer: "5.00" }));
    const out = await read({ fileKey: "k.png", question: "How much was the tip?" });
    expect(out.answer).toBe("5.00");
    expect(fake.calls).toHaveLength(1);
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
    expect(await read({ fileKey: "k.png" })).not.toHaveProperty("fields");
  });
});

/**
 * Inside the agent graph, a call that inherits the graph's context or handlers gets LangGraph's
 * stream handler: its reply streams into the chat as the agent's words and arrives in a format
 * the structured-output parser reads as empty. The reader must run as a unit of its own.
 */
describe("read_document — runs outside the agent's graph", () => {
  class StreamHandler extends BaseCallbackHandler {
    name = "langgraph_stream";
  }

  /** Invoke the tool the way the agent's ToolNode does: inside a run with the graph's handlers. */
  async function readInsideGraph() {
    const tracer = new GenAiTracer({ captureContent: false });
    const graphCallbacks = new CallbackManager("tool-run-id");
    graphCallbacks.addHandler(new StreamHandler());
    graphCallbacks.addHandler(tracer);
    const [tool] = tools();
    await AsyncLocalStorageProviderSingleton.runWithConfig({ callbacks: graphCallbacks }, () =>
      tool.invoke({ fileKey: "k.png" }, { callbacks: graphCallbacks }),
    );
    return { tracer, call: fake.calls[0] };
  }

  it("does not inherit the graph's context", async () => {
    const { call } = await readInsideGraph();
    expect(call.inheritedStore).toBeUndefined();
  });

  it("keeps only Cameron's tracer, parented to the tool's run", async () => {
    const { tracer, call } = await readInsideGraph();
    const manager = call.options.callbacks as CallbackManager;
    expect(manager.handlers).toEqual([tracer]);
    expect(manager.getParentRunId()).toBeDefined();
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

  // A reply cut off at the output limit is truncated JSON. "Retry" would cut it off again.
  it.each(["length", "max_tokens", "MAX_TOKENS"])(
    "too_long when the reply stopped at the output limit (%s)",
    async (reason) => {
      fake.returns(() => null);
      fake.replies(
        () =>
          new AIMessage({
            content: '{"kind": "invoice", "text": "…',
            response_metadata: { finish_reason: reason, stop_reason: reason, finishReason: reason },
          }),
      );
      const out = await read({ fileKey: "k.pdf" });
      expect(out.error).toBe("too_long");
      expect(out.message).toContain("Retrying will not help");
    },
  );

  it("invalid_reading when the reply does not parse", async () => {
    fake.returns(() => null);
    expect((await read({ fileKey: "k.png" })).error).toBe("invalid_reading");
  });

  const failWith = (name: string, message = "boom") =>
    fake.returns(() => {
      throw Object.assign(new Error(message), { name });
    });

  it("timeout", async () => {
    failWith("TimeoutError");
    expect((await read({ fileKey: "k.png" })).error).toBe("timeout");
  });

  it("model_cannot_read names the model and quotes the provider", async () => {
    failWith("BadRequestError", "400 image input is not supported for this model");
    const out = await read({ fileKey: "k.png" });
    expect(out.error).toBe("model_cannot_read");
    expect(out.message).toContain("openai:test-model");
    expect(out.message).toContain("image input is not supported");
  });
});
