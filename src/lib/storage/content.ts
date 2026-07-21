import { getFile } from "./upload";
import { FileAttachment } from "@/types/message";

/**
 * Download a file from S3/MinIO and convert to base64
 * @param key File key in bucket
 * @returns Base64 encoded string
 */
export async function downloadFileAsBase64(key: string): Promise<string> {
  const buffer = await getFile(key);
  return buffer.toString("base64");
}

/**
 * Create a data URL for an image file
 * @param attachment File attachment metadata
 * @returns Data URL string (e.g., "data:image/jpeg;base64,...")
 */
export async function getFileDataUrl(attachment: FileAttachment): Promise<string> {
  const base64 = await downloadFileAsBase64(attachment.key);
  return `data:${attachment.type};base64,${base64}`;
}

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
 * Prepare a PDF file for AI processing (base64 data URL)
 * @param attachment PDF file attachment metadata
 * @returns Data URL for PDF
 */
export async function preparePdfForAI(attachment: FileAttachment): Promise<string> {
  const base64 = await downloadFileAsBase64(attachment.key);
  return `data:application/pdf;base64,${base64}`;
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

/**
 * Process file attachments and convert to AI-compatible format
 * @param attachments Array of file attachments
 * @returns Array of content items for LangChain HumanMessage
 */
export async function processAttachmentsForAI(
  attachments: FileAttachment[],
): Promise<
  Array<{ type: string; image_url?: { url: string }; text?: string; file_metadata?: FileMetadata }>
> {
  const contentItems: Array<{
    type: string;
    image_url?: { url: string };
    text?: string;
    file_metadata?: FileMetadata;
  }> = [];

  for (const attachment of attachments) {
    try {
      // Extract file extension for fallback detection
      const extension = attachment.name.split(".").pop()?.toLowerCase() || "";

      // Process images
      if (attachment.type.startsWith("image/")) {
        const dataUrl = await getFileDataUrl(attachment);
        contentItems.push({
          type: "image_url",
          image_url: { url: dataUrl },
          file_metadata: {
            url: attachment.url,
            key: attachment.key,
            name: attachment.name,
            type: attachment.type,
            size: attachment.size,
          },
        });
      }
      // Process PDFs
      else if (attachment.type === "application/pdf") {
        const dataUrl = await preparePdfForAI(attachment);
        contentItems.push({
          type: "image_url", // Gemini uses image_url type for PDFs too
          image_url: { url: dataUrl },
          file_metadata: {
            url: attachment.url,
            key: attachment.key,
            name: attachment.name,
            type: attachment.type,
            size: attachment.size,
          },
        });
      }
      // Text-like files (markdown, plain text, CSV) are sent as a REFERENCE, not inlined.
      // Inlining raw content (e.g. a whole CSV export) bloats the model's context and defeats
      // the CSV-import handshake, whose whole point is that rows never reach the model. Instead
      // we surface the fileKey so the agent can pull/inspect the file on demand via a tool
      // (e.g. inspect_csv). Images and PDFs still go inline above (the model reads them directly).
      // Checks both MIME type and extension (for application/octet-stream cases).
      else if (
        attachment.type.startsWith("text/") ||
        attachment.type === "application/csv" ||
        (attachment.type === "application/octet-stream" &&
          ["md", "markdown", "txt", "csv"].includes(extension))
      ) {
        contentItems.push({
          type: "text",
          text:
            `\n\n[Attached file: ${attachment.name} ` +
            `(${attachment.type}, ${attachment.size} bytes). fileKey: ${attachment.key}]\n` +
            `The file's contents are NOT included here. To read or import it, call the ` +
            `appropriate tool with this fileKey (e.g. inspect_csv for a CSV).`,
          // Preserved so the chat UI still renders the file chip/download link, and so this
          // reference stays out of the user-visible bubble (getMessageContent skips file_metadata).
          file_metadata: {
            url: attachment.url,
            key: attachment.key,
            name: attachment.name,
            type: attachment.type,
            size: attachment.size,
          },
        });
      }
    } catch (error) {
      console.error(`Failed to process attachment ${attachment.name}:`, error);
      throw new Error(`Failed to process attachment ${attachment.name}`);
    }
  }

  return contentItems;
}
