import { describe, it, expect, vi, beforeEach } from "vitest";

const openFile = vi.fn();
vi.mock("@/lib/storage/upload", () => ({ openFile: (key: string) => openFile(key) }));

const { GET } = await import("./route");

const KEY = "3f2b9c1e-8a4d-4f6e-9b2a-1c3d5e7f9a0b.png";
const get = (key: string) => GET(new Request("http://x"), { params: Promise.resolve({ key }) });

beforeEach(() => {
  openFile.mockReset();
});

describe("GET /api/files/[key]", () => {
  it("streams an upload with its stored headers", async () => {
    openFile.mockResolvedValue({
      body: new Blob(["png-bytes"]).stream(),
      contentType: "image/png",
      contentLength: 9,
      contentDisposition: 'attachment; filename="r.png"',
    });

    const res = await get(KEY);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("png-bytes");
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="r.png"');
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("404s a missing upload", async () => {
    openFile.mockResolvedValue(null);
    expect((await get(KEY)).status).toBe(404);
  });

  // The route is the only way into the private bucket, so it serves upload keys and nothing else.
  it.each(["eval/fixtures/transactions-fr.csv", "../secret", "not-a-uuid.png", `${KEY}/x`, ""])(
    "refuses a key the upload route never mints: %j",
    async (key) => {
      expect((await get(key)).status).toBe(404);
      expect(openFile).not.toHaveBeenCalled();
    },
  );

  it("500s, without the storage error, when storage fails", async () => {
    openFile.mockImplementation(async () => {
      throw new Error("connect ECONNREFUSED minio:9000");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await get(KEY);

    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("minio");
  });
});
