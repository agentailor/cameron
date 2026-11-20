import type { DocumentReading } from "@/lib/documents/reading";

export type { DocumentReading };

/** A document the agent has read. Plain domain object returned by `documentRepository`. */
export interface DocumentRecord {
  id: string;
  fileKey: string;
  contentHash: string;
  mimeType: string;
  reading: DocumentReading;
  readWith: string;
  createdAt: Date;
  updatedAt: Date;
}
