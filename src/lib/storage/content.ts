import { getFile } from "./upload";
import { FileAttachment } from "@/types/message";

/**
 * Extract text content from a text file
 * @param key File key in bucket
 * @returns Text content as string
 */
export async function extractTextContent(key: string): Promise<string> {
  const buffer = await getFile(key);
  return buffer.toString("utf-8");
}

/**
 * File metadata embedded in content items for UI display after checkpoint serialization
 */
interface FileMetadata {
  url: string;
  key: string;
  name: string;
  type: string;
  size: number;
}

export interface AttachmentReference {
  type: "text";
  text: string;
  file_metadata: FileMetadata;
}

const TEXT_EXTENSIONS = ["md", "markdown", "txt", "csv"];

function isDocument(attachment: FileAttachment): boolean {
  return attachment.type.startsWith("image/") || attachment.type === "application/pdf";
}

function isText(attachment: FileAttachment): boolean {
  const extension = attachment.name.split(".").pop()?.toLowerCase() || "";
  return (
    attachment.type.startsWith("text/") ||
    attachment.type === "application/csv" ||
    (attachment.type === "application/octet-stream" && TEXT_EXTENSIONS.includes(extension))
  );
}

/**
 * Turn attachments into the content items of the user's message.
 *
 * Every attachment goes to the model as a REFERENCE carrying its fileKey, never inlined: inline
 * bytes would sit in the checkpoint and be re-sent every turn, and a CSV's rows must never reach
 * the model at all. The agent reads a file with a tool — `read_document` for an image or PDF,
 * `inspect_csv` for a CSV.
 */
export async function processAttachmentsForAI(
  attachments: FileAttachment[],
): Promise<AttachmentReference[]> {
  const items: AttachmentReference[] = [];

  for (const attachment of attachments) {
    const document = isDocument(attachment);
    if (!document && !isText(attachment)) continue;

    items.push({
      type: "text",
      text:
        `\n\n[Attached file: ${attachment.name} ` +
        `(${attachment.type}, ${attachment.size} bytes). fileKey: ${attachment.key}]\n` +
        (document
          ? "Its contents are NOT included here. To see what it says, call read_document with " +
            "this fileKey."
          : "The file's contents are NOT included here. To read or import it, call the " +
            "appropriate tool with this fileKey (e.g. inspect_csv for a CSV)."),
      // Keeps the chip in the chat UI, and keeps this reference out of the visible bubble
      // (getMessageContent skips items with file_metadata).
      file_metadata: {
        url: attachment.url,
        key: attachment.key,
        name: attachment.name,
        type: attachment.type,
        size: attachment.size,
      },
    });
  }

  return items;
}
