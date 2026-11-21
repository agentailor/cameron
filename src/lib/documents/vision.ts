import { HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Callbacks } from "@langchain/core/callbacks/manager";
import { AsyncLocalStorageProviderSingleton } from "@langchain/core/singletons";
import { z } from "zod";
import { tracerOnlyCallbacks } from "@/lib/tracing/genAiTracer";
import { DocumentReadingSchema, normalizeReading, type DocumentReading } from "./reading";
import { READER_SYSTEM_PROMPT } from "./reader.prompt";

/**
 * The document reader behind `read_document`: one call to the agent's model, run as a unit of its
 * own rather than as part of the agent's graph. See docs/DOCUMENTS.md.
 */

export const VISION_TIMEOUT_MS = 90_000;

/** Types the model is handed; anything else is refused before a call is made. */
export const READABLE_TYPES = {
  "image/png": "image",
  "image/jpeg": "image",
  "image/jpg": "image",
  "application/pdf": "file",
} as const;
export type ReadableType = keyof typeof READABLE_TYPES;

export function isReadableType(type: string | undefined): type is ReadableType {
  return !!type && type in READABLE_TYPES;
}

export interface DocumentFile {
  data: Buffer;
  mimeType: ReadableType;
  /** Required by OpenAI for file blocks. */
  filename: string;
}

export interface VisionCallOptions {
  /** The tool's callbacks. Only Cameron's tracer is kept from them. */
  callbacks?: Callbacks;
}

/** No reading could be taken from the reply; read_document reports it as `invalid_reading`. */
export class InvalidReadingError extends Error {
  name = "InvalidReadingError";
}

/** The reply was cut off at the model's output limit; read_document reports it as `too_long`. */
export class ReadingTooLongError extends Error {
  name = "ReadingTooLongError";
}

/** Stop reasons meaning "ran out of output tokens", per provider. */
const CUT_OFF = new Set(["length", "max_tokens", "MAX_TOKENS"]);

function wasCutOff(message: BaseMessage): boolean {
  const meta = (message.response_metadata ?? {}) as Record<string, unknown>;
  const reason = meta.finish_reason ?? meta.stop_reason ?? meta.finishReason;
  return typeof reason === "string" && CUT_OFF.has(reason);
}

/**
 * Run `fn` with no inherited LangChain context. Inside a tool, LangChain hands every call the
 * graph's run config, and with it LangGraph's stream handler: the reader's reply would stream
 * into the chat as the agent's words, and arrive in a format the structured-output parser reads
 * as empty. Run on its own, the reader behaves as it does standalone.
 */
function outsideGraph<T>(fn: () => Promise<T>): Promise<T> {
  return AsyncLocalStorageProviderSingleton.getInstance().run(undefined as never, fn);
}

function documentMessage(file: DocumentFile, instruction: string): HumanMessage {
  return new HumanMessage({
    contentBlocks: [
      { type: "text", text: instruction },
      {
        type: READABLE_TYPES[file.mimeType],
        data: file.data.toString("base64"),
        mimeType: file.mimeType === "image/jpg" ? "image/jpeg" : file.mimeType,
        metadata: { filename: file.filename },
      },
    ],
  } as never);
}

/** Read a document, optionally answering a question about it in the same call. */
export async function readWithModel(
  model: BaseChatModel,
  file: DocumentFile,
  question?: string,
  opts: VisionCallOptions = {},
): Promise<{ reading: DocumentReading; answer?: string }> {
  const schema = question
    ? DocumentReadingSchema.extend({
        answer: z.string().describe("Answer to the question, from the document alone"),
      })
    : DocumentReadingSchema;
  const instruction = question
    ? `Read this document, then answer this question about it: ${question}`
    : "Read this document.";

  const out = (await outsideGraph(() =>
    model
      .withStructuredOutput(schema, { name: "document_reading", includeRaw: true })
      .invoke([new SystemMessage(READER_SYSTEM_PROMPT), documentMessage(file, instruction)], {
        signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
        callbacks: tracerOnlyCallbacks(opts.callbacks),
      }),
  )) as {
    raw: BaseMessage;
    parsed: (DocumentReading & { answer?: string }) | null;
    parsingError?: unknown;
  };

  // A reply cut off at the output limit is unparseable JSON; say why instead of "retry".
  if (wasCutOff(out.raw)) {
    throw new ReadingTooLongError("the reading did not fit in one reply from the model");
  }
  if (!out.parsed) {
    const cause = out.parsingError instanceof Error ? out.parsingError.message : "no reading";
    throw new InvalidReadingError(cause.slice(0, 200));
  }

  const { answer, ...reading } = out.parsed;
  return { reading: normalizeReading(reading), ...(question ? { answer } : {}) };
}
