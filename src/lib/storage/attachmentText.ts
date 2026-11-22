/**
 * The text the model gets in place of an attachment: a reference carrying its fileKey, never its
 * contents. A zero-import leaf so the eval harness builds the same text the app sends.
 */

export interface AttachmentDescriptor {
  key: string;
  name: string;
  type: string;
  size: number;
}

export function isDocumentType(type: string): boolean {
  return type.startsWith("image/") || type === "application/pdf";
}

export function attachmentReferenceText(attachment: AttachmentDescriptor): string {
  return (
    `\n\n[Attached file: ${attachment.name} ` +
    `(${attachment.type}, ${attachment.size} bytes). fileKey: ${attachment.key}]\n` +
    (isDocumentType(attachment.type)
      ? "Its contents are NOT included here. To see what it says, call read_document with " +
        "this fileKey."
      : "The file's contents are NOT included here. To read or import it, call the " +
        "appropriate tool with this fileKey (e.g. inspect_csv for a CSV).")
  );
}
