/**
 * Where the browser fetches an uploaded file: the app's own `/api/files` route, never the bucket.
 * The bucket is private, so a direct MinIO/S3 link would 403. Zero-import leaf: client components
 * build URLs from a stored key with it.
 */

/** Exactly the keys the upload route mints (`<uuid>.<ext>`); nothing else in the bucket is served. */
const UPLOAD_KEY =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9]{1,16}$/;

export function isServableFileKey(key: string): boolean {
  return UPLOAD_KEY.test(key);
}

export function fileUrl(key: string): string {
  return `/api/files/${encodeURIComponent(key)}`;
}
