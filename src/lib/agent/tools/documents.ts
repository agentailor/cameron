import { createHash } from "node:crypto";
import { tool } from "@langchain/core/tools";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Callbacks } from "@langchain/core/callbacks/manager";
import { z } from "zod";
import * as documentRepo from "@/lib/repositories/documentRepository";
import { getFileWithType } from "@/lib/storage/upload";
import {
  askWithModel,
  isReadableType,
  readWithModel,
  type DocumentFile,
} from "@/lib/documents/vision";
import type { DocumentReading } from "@/lib/documents/reading";

/**
 * `read_document`: the only way the agent sees an uploaded image or PDF. Attachments reach the
 * model as a fileKey reference (storage/content.ts), so every one goes through here, and the
 * reading is stored by content hash so the same bytes are read once. See docs/DOCUMENTS.md.
 */

/** Transcription returned to the agent; the full text stays on the stored reading. */
export const MAX_TEXT_CHARS = 6000;

export interface DocumentToolsOptions {
  /** The agent's own model — v6 reads documents with the provider the owner chose. */
  model: BaseChatModel;
  /** "provider:model", stored with each reading and named in errors. */
  readWith: string;
}

function readingPayload(
  documentId: string,
  reading: DocumentReading,
  extra: { answer?: string; readBefore: boolean },
) {
  const truncated = reading.text.length > MAX_TEXT_CHARS;
  return {
    ok: true,
    documentId,
    kind: reading.kind,
    summary: reading.summary,
    ...(reading.fields ? { fields: reading.fields } : {}),
    text: truncated ? reading.text.slice(0, MAX_TEXT_CHARS) : reading.text,
    truncated,
    ...(truncated ? { textLength: reading.text.length } : {}),
    ...(extra.answer !== undefined ? { answer: extra.answer } : {}),
    ...(extra.readBefore ? { readBefore: true } : {}),
  };
}

function failure(error: unknown, readWith: string) {
  const name = error instanceof Error ? error.name : "";
  const reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
  if (name === "TimeoutError" || name === "AbortError") {
    return {
      error: "timeout",
      message:
        `${readWith} took too long to read the document. Tell the user and offer to try again; ` +
        "do not describe the document's contents, you have not seen them.",
    };
  }
  const code = (error as { lc_error_code?: string } | null)?.lc_error_code;
  if (
    name === "ReadingParseError" ||
    name === "ZodError" ||
    name === "OutputParserException" ||
    code === "OUTPUT_PARSING_FAILURE"
  ) {
    return {
      error: "invalid_reading",
      message:
        `${readWith} returned a reading that did not match the expected shape (${reason}). ` +
        "Retry once; if it fails again, tell the user the document could not be read.",
    };
  }
  return {
    error: "model_cannot_read",
    message:
      `The configured model (${readWith}) could not read the document: ${reason}. It may not ` +
      "accept images or PDFs. Tell the user, quoting the reason, and do not guess the contents.",
  };
}

export function createDocumentTools({ model, readWith }: DocumentToolsOptions) {
  const readDocument = tool(
    async (input, config?: { callbacks?: Callbacks }) => {
      let file: { buffer: Buffer; contentType: string | undefined };
      try {
        file = await getFileWithType(input.fileKey);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return JSON.stringify({
          error: "file_unreadable",
          message:
            `Could not read the file for fileKey "${input.fileKey}": ${message}. Use the exact ` +
            "fileKey from the attachment reference ([Attached file: … fileKey: <key>]) — never " +
            "invent one — and ask the user to re-upload if there is no such reference.",
        });
      }

      if (!isReadableType(file.contentType)) {
        return JSON.stringify({
          error: "unsupported_type",
          message:
            `read_document reads PNG, JPEG and PDF files; this one is ${file.contentType ?? "of unknown type"}. ` +
            "For a CSV use inspect_csv.",
        });
      }

      const doc: DocumentFile = {
        data: file.buffer,
        mimeType: file.contentType,
        filename: input.fileKey,
      };
      const contentHash = createHash("sha256").update(file.buffer).digest("hex");
      const opts = { callbacks: config?.callbacks };

      try {
        const existing = await documentRepo.getByHash(contentHash);
        if (existing) {
          // Only a question costs a call on a file already read; its reading is reused as stored.
          const answer = input.question
            ? await askWithModel(model, doc, input.question, opts)
            : undefined;
          return JSON.stringify(
            readingPayload(existing.id, existing.reading, { answer, readBefore: true }),
          );
        }

        const { reading, answer } = await readWithModel(model, doc, input.question, opts);
        const stored = await documentRepo.create({
          fileKey: input.fileKey,
          contentHash,
          mimeType: file.contentType,
          reading,
          readWith,
        });
        return JSON.stringify(
          readingPayload(stored.id, stored.reading, {
            answer,
            readBefore: stored.fileKey !== input.fileKey,
          }),
        );
      } catch (err) {
        return JSON.stringify(failure(err, readWith));
      }
    },
    {
      name: "read_document",
      description:
        "Read an uploaded image (PNG, JPEG) or PDF. Attached images and PDFs reach you only as a " +
        "fileKey reference, never as content — call this to see what is in one, before answering " +
        "anything about it. Returns the document's kind (receipt / invoice / other), a one-line " +
        "summary and a faithful transcription; for a receipt or invoice also `fields` (merchant, " +
        "date as printed, total, subtotal, tax, tip, currency). A field the reader could not make " +
        "out is null and named in `fields.unreadable`: never fill it in yourself, not even by " +
        "adding up other lines — ask the user. `truncated: true` means `text` was cut short. " +
        "Read-only — runs without approval and writes nothing to the ledger.",
      schema: z.object({
        fileKey: z
          .string()
          .min(1)
          .describe("The fileKey from the attachment reference, copied exactly"),
        question: z
          .string()
          .optional()
          .describe(
            "Only for something a transcription cannot carry — layout, a stamp, a logo, which " +
              "line a handwritten note sits on. Leave it out to just read the document; a " +
              "question costs an extra model call on a file already read.",
          ),
      }),
    },
  );

  return [readDocument];
}
