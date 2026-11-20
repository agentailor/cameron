import { NextResponse } from "next/server";
import { isServableFileKey } from "@/lib/storage/fileUrl";
import { openFile } from "@/lib/storage/upload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Serves an uploaded file from the private bucket. See docs/ARCHITECTURE.md (File storage). */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!isServableFileKey(key)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const file = await openFile(key);
    if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const headers = new Headers({
      "Content-Type": file.contentType || "application/octet-stream",
      // Same-origin user content: never sniffed, never run.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      // Keys are unique per upload, so the bytes behind one never change.
      "Cache-Control": "private, max-age=31536000, immutable",
    });
    if (file.contentLength !== undefined) headers.set("Content-Length", String(file.contentLength));
    if (file.contentDisposition) headers.set("Content-Disposition", file.contentDisposition);

    return new Response(file.body, { headers });
  } catch (error) {
    console.error("File read error:", error);
    return NextResponse.json({ error: "Could not read file" }, { status: 500 });
  }
}
