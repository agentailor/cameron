import { describe, expect, it, vi } from "vitest";
import type { FileAttachment } from "@/types/message";

// content.ts reaches the S3 client, which throws at module load without credentials.
vi.mock("./upload", () => ({ getFile: vi.fn() }));
const { processAttachmentsForAI } = await import("./content");

const attachment = (type: string, name: string): FileAttachment =>
  ({ url: `/api/files/${name}`, key: name, name, type, size: 10 }) as FileAttachment;

describe("processAttachmentsForAI", () => {
  // Inline bytes sit in the checkpoint and are re-sent to the model on every later turn.
  it.each([
    ["image/png", "r.png"],
    ["image/jpeg", "r.jpg"],
    ["application/pdf", "r.pdf"],
  ])("sends %s as a read_document reference, never its bytes", async (type, name) => {
    const [item] = await processAttachmentsForAI([attachment(type, name)]);
    expect(item.type).toBe("text");
    expect(item.text).toContain(`fileKey: ${name}`);
    expect(item.text).toContain("read_document");
    expect(JSON.stringify(item)).not.toMatch(/base64|data:/);
    expect(item.file_metadata.key).toBe(name);
  });

  it("points a CSV at inspect_csv", async () => {
    const [item] = await processAttachmentsForAI([attachment("text/csv", "t.csv")]);
    expect(item.text).toContain("inspect_csv");
    expect(item.text).not.toContain("read_document");
  });
});
