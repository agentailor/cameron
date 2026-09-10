import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The returned URL is what the BROWSER is handed, and it is built from a different variable than
 * the one the server uploads through. Getting that wrong produces an upload that succeeds and a
 * link that 404s — a failure that passes a smoke test, which is why it is pinned here.
 *
 * `s3-client` is mocked because it throws at module load without credentials, and because these
 * assertions are about URL construction, not about S3.
 */
vi.mock("./s3-client", () => ({
  s3Client: { send: vi.fn().mockResolvedValue({}) },
  BUCKET_NAME: "uploads",
}));

const ORIGINAL_ENV = process.env;

async function uploadAndGetUrl(): Promise<string> {
  // Re-imported per test: the module reads process.env at call time, but a fresh registry keeps
  // each case independent of module-level caching elsewhere.
  const { uploadFile } = await import("./upload");
  return uploadFile(Buffer.from("x"), "abc.csv", "text/csv", "abc.csv");
}

beforeEach(() => {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("uploadFile returned URL", () => {
  it("falls back to S3_ENDPOINT when S3_PUBLIC_URL is unset (the host workflow)", async () => {
    process.env.S3_ENDPOINT = "http://localhost:9100";
    delete process.env.S3_PUBLIC_URL;

    expect(await uploadAndGetUrl()).toBe("http://localhost:9100/uploads/abc.csv");
  });

  it("prefers S3_PUBLIC_URL over S3_ENDPOINT when the two differ (the container split)", async () => {
    // What compose sets: the server reaches MinIO on the compose network, the browser cannot.
    process.env.S3_ENDPOINT = "http://minio:9000";
    process.env.S3_PUBLIC_URL = "http://localhost:9100";

    const url = await uploadAndGetUrl();

    expect(url).toBe("http://localhost:9100/uploads/abc.csv");
    // The internal hostname must never reach the browser.
    expect(url).not.toContain("minio:9000");
  });

  it("yields a bucket-relative path when neither is set, rather than 'undefined' in the URL", async () => {
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_PUBLIC_URL;

    expect(await uploadAndGetUrl()).toBe("/uploads/abc.csv");
  });
});
