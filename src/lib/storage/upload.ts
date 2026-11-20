import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { s3Client, BUCKET_NAME } from "./s3-client";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { fileUrl } from "./fileUrl";

function sanitizeFilenameForHeader(filename: string): string | undefined {
  // Prevent HTTP header injection (CRLF) and other control characters.
  // Also strip path separators to avoid confusing download dialogs.
  const stripped = filename
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[\\/]/g, "_")
    .trim();

  if (!stripped) return undefined;

  // Keep a reasonable upper bound to avoid very large header values.
  return stripped.slice(0, 180);
}

function escapeQuotedString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildContentDispositionAttachment(originalFilename: string): string | undefined {
  const safe = sanitizeFilenameForHeader(originalFilename);
  if (!safe) return undefined;

  // Provide an ASCII-ish fallback for broad compatibility.
  const fallback = safe.replace(/[^\x20-\x7E]/g, "_");
  const quotedFallback = escapeQuotedString(fallback || "download");

  // RFC 5987 / 6266 encoding for UTF-8 filenames.
  const encoded = encodeURIComponent(safe).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `attachment; filename="${quotedFallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Upload a file to S3/MinIO
 * @param buffer File buffer to upload
 * @param key Unique file key (path in bucket)
 * @param contentType MIME type of the file
 * @param originalFilename Original filename for Content-Disposition header
 * @returns App-relative URL the browser fetches the file from
 */
export async function uploadFile(
  buffer: Buffer,
  key: string,
  contentType: string,
  originalFilename?: string,
): Promise<string> {
  const contentDisposition = originalFilename
    ? buildContentDispositionAttachment(originalFilename)
    : undefined;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    // Set Content-Disposition so browser uses original filename when downloading
    ...(contentDisposition && { ContentDisposition: contentDisposition }),
  });

  await s3Client.send(command);

  return fileUrl(key);
}

/**
 * Upload a large file using multipart upload (for files > 5MB)
 * @param buffer File buffer to upload
 * @param key Unique file key (path in bucket)
 * @param contentType MIME type of the file
 * @param originalFilename Original filename for Content-Disposition header
 * @returns App-relative URL the browser fetches the file from
 */
export async function uploadLargeFile(
  buffer: Buffer,
  key: string,
  contentType: string,
  originalFilename?: string,
): Promise<string> {
  const contentDisposition = originalFilename
    ? buildContentDispositionAttachment(originalFilename)
    : undefined;

  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      // Set Content-Disposition so browser uses original filename when downloading
      ...(contentDisposition && { ContentDisposition: contentDisposition }),
    },
    // Multipart upload configuration
    queueSize: 4, // concurrent uploads
    partSize: 5 * 1024 * 1024, // 5MB parts
  });

  await upload.done();

  return fileUrl(key);
}

/**
 * Get file buffer from S3/MinIO
 * @param key File key in bucket
 * @returns File buffer
 */
export async function getFile(key: string): Promise<Buffer> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  const response = await s3Client.send(command);

  if (!response.Body) {
    throw new Error("File not found");
  }

  // Convert stream to buffer
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

export interface StoredFile {
  body: ReadableStream;
  contentType?: string;
  contentLength?: number;
  contentDisposition?: string;
}

/** Stream an object for the file route; `null` when the key does not exist. */
export async function openFile(key: string): Promise<StoredFile | null> {
  try {
    const response = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
    if (!response.Body) return null;
    return {
      body: response.Body.transformToWebStream(),
      contentType: response.ContentType,
      contentLength: response.ContentLength,
      contentDisposition: response.ContentDisposition,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "NoSuchKey") return null;
    throw error;
  }
}

/**
 * Generate a presigned URL for private file access
 * @param key File key in bucket
 * @param expiresIn Expiration time in seconds (default: 1 hour)
 * @returns Presigned URL
 */
export async function getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
}
