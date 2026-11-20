import { describe, it, expect, vi } from "vitest";

/**
 * The returned URL is what the BROWSER is handed. The bucket is private, so it must point at the
 * app's file route and never at the storage endpoint, whatever S3_ENDPOINT says.
 *
 * `s3-client` is mocked because it throws at module load without credentials.
 */
vi.mock("./s3-client", () => ({
  s3Client: { send: vi.fn().mockResolvedValue({}) },
  BUCKET_NAME: "uploads",
}));

describe("uploadFile returned URL", () => {
  it("points at the file route, never at the storage endpoint", async () => {
    process.env.S3_ENDPOINT = "http://minio:9000";
    const { uploadFile } = await import("./upload");

    const url = await uploadFile(Buffer.from("x"), "abc.csv", "text/csv", "abc.csv");

    expect(url).toBe("/api/files/abc.csv");
    expect(url).not.toContain("minio");
  });
});
