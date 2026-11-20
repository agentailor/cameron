# Documents

How Cameron reads an uploaded image or PDF: receipts, invoices, anything else.

## The path a file takes

1. The owner attaches a PNG, JPEG or PDF. It is uploaded to the private bucket
   (`/api/agent/upload`) and the message carries its metadata.
2. `processAttachmentsForAI` (`src/lib/storage/content.ts`) turns it into a **reference** in the
   user's message — `[Attached file: receipt.png (image/png, …). fileKey: <key>]` — never the bytes.
3. The model can't see the file, so to answer anything about it, it calls **`read_document`** with
   the key.
4. `read_document` fetches the bytes, hashes them, and either returns the stored reading for that
   hash or reads the file with the agent's own model and stores the result on the `document` table.

The file's bytes are never inlined into the conversation. Inlined, they would be saved in the
thread's checkpoint and re-sent to the model on every later turn of that thread. That's the same
reason a CSV's rows never reach the model either.

## `read_document(fileKey, question?)`

Read-only, so it runs without approval and writes nothing to the ledger.

A successful call returns:

```jsonc
{
  "ok": true,
  "documentId": "…",
  "kind": "receipt", // receipt | invoice | other
  "summary": "Restaurant receipt from CORNER BISTRO",
  "fields": {
    // only for a receipt or invoice
    "merchant": "CORNER BISTRO",
    "date": "14/03/2026", // as printed, never reformatted
    "total": null,
    "subtotal": 38.5,
    "tax": 3.85,
    "tip": 5,
    "currency": "EUR",
    "unreadable": ["total"],
  },
  "text": "CORNER BISTRO\n…\nTOTAL EUR [illegible]",
  "truncated": false,
  "answer": "…", // only when `question` was passed
  "readBefore": true, // only when these bytes were read before
}
```

### Unreadable means null

A field that is on the document but can't be read is `null` and named in `fields.unreadable`.
The reader is told never to compute a value it can't see, not even one it could add up from the
other lines. A model may still do it, so `normalizeReading` (`src/lib/documents/reading.ts`)
enforces the rule on the server: any value beside an `unreadable` entry is dropped. A number
standing next to "unreadable" is exactly the guess that would end up in the ledger.

The date is returned as printed. Whether `03/04` means March or April is decided later, where the
owner can see the decision, not silently by the reader.

### One reading per file

Readings are stored by the sha256 of the file's bytes, so uploading the same receipt twice reads it
once. The second upload gets the stored reading back with `readBefore: true` and costs no model
call. Only a `question` asked about a file that was already read costs a call, and that answer is
not stored.

`question` is for what a transcription can't carry: layout, a stamp, a logo, where a handwritten
note sits. Most questions about a document can be answered from `text`.

`text` is capped at 6,000 characters in the payload (`truncated: true`, plus `textLength`); the
stored reading keeps all of it.

### Failures

Every failure comes back as a payload the agent can act on, and a failed read stores nothing:

| `error`             | When                                                               |
| ------------------- | ------------------------------------------------------------------ |
| `file_unreadable`   | No such key in storage — usually an invented key                   |
| `unsupported_type`  | Not PNG, JPEG or PDF (a CSV is pointed at `inspect_csv`)           |
| `timeout`           | The model took longer than 90 s                                    |
| `invalid_reading`   | The model's reply didn't fit the reading schema                    |
| `model_cannot_read` | Anything else from the provider — typically a model without vision |

`model_cannot_read` names the configured model and quotes the provider's own message, rather than
sniffing for "this model can't take images". Error text varies by provider, and a matcher would
misclassify the next one. Each message tells the agent not to describe a document it hasn't seen.

## Which model reads

The **agent's own model**, the provider and model the owner picked in Settings (or the explicit
pair the eval harness passes). `createDocumentTools({ model, readWith })` is built inside
`buildAgent` from the same instance the agent runs on, and `readWith` (`provider:model`) is stored
with each reading.

So a document goes to whichever provider the owner chose for chat, and no other. A separate
document model (for an owner who doesn't want files sent to the chat provider) is a possible later
option, not something this version does.

The file is sent as a LangChain standard content block: `{ type: "image" | "file", data, mimeType,
metadata: { filename } }`. LangChain's Anthropic, Google and OpenAI packages each map these to
their native image / PDF input. OpenAI requires the `filename`. So far it has been checked live
only against an OpenAI-compatible endpoint.

### Parsing the reply inside the agent graph

Run on its own, `withStructuredOutput` parses the reply fine. Run from inside the agent graph, the
call inherits LangChain's **v1 output format** from the graph's run config: the reply's `content`
is an array of blocks, the structured-output parser reads it as no text at all, and it fails with
`Failed to parse. Text: "undefined"`, even though the JSON is right there. A fresh model instance
inherits it too, and so does a call made without passing callbacks (LangChain propagates the parent
config through AsyncLocalStorage). A call option on the outer `invoke` doesn't reach the model
through the structured-output runnable.

So `readWithModel` asks for `includeRaw: true`. When `parsed` is empty, it takes the JSON from
`raw.text` (which joins text blocks in either format, `json` fence or not), then validates it
against the schema either way. A reply that is not JSON, or not a valid reading, is
`invalid_reading`. `documents.test.ts` pins the v1 case. A standalone test of the vision call
can't catch this; only a call made from a tool inside the graph can.

## Tracing and streaming

The vision call runs with the tool's callbacks, so it shows up as a `chat` span under the tool's
`execute_tool` span, with its token usage. The tracer names image and file blocks without
including their bytes, even with content capture on.

The call is also tagged `nostream`. With the graph's callbacks attached, LangGraph would otherwise
stream the reader's structured reply into the chat as if the agent had written it.

## Storage

`document` (`src/lib/repositories/documentRepository.ts`): `id`, `file_key` (the first upload of
these bytes), `content_hash` (unique), `mime_type`, `reading` (jsonb), `read_with`. It is not
granted to `cameron_analytics`, so `run_sql` can't read it.
