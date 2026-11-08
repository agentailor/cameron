import { describe, expect, it, vi } from "vitest";
import {
  hashTools,
  heuristicSummary,
  normalizeTools,
  refreshServerCatalog,
  summaryFromInstructions,
  truncate,
  type CatalogRefreshDeps,
} from "./catalog";
import type { ServerCatalogEntry, ServerManifest } from "./types";

const server = { id: "s1", name: "bank" };
const manifest: ServerManifest = {
  tools: [
    { name: "list_transactions", description: "List", inputSchema: { type: "object", b: 1, a: 2 } },
    { name: "balance", description: "Balance", inputSchema: { type: "object" } },
  ],
};

function deps(over: Partial<CatalogRefreshDeps> = {}, previous: ServerCatalogEntry | null = null) {
  const written: ServerCatalogEntry[] = [];
  const d: CatalogRefreshDeps = {
    fetchManifest: async () => manifest,
    readEntry: async () => previous,
    writeEntry: async (e) => void written.push(e),
    now: () => new Date("2026-10-23T00:00:00Z"),
    ...over,
  };
  return { d, written };
}

describe("normalizeTools / hashTools", () => {
  it("hashes the same tools identically regardless of order and key order", () => {
    const reordered = [
      { name: "balance", inputSchema: { type: "object" }, description: "Balance" },
      {
        name: "list_transactions",
        description: "List",
        inputSchema: { a: 2, type: "object", b: 1 },
      },
    ];
    expect(hashTools(normalizeTools(reordered))).toBe(hashTools(normalizeTools(manifest.tools)));
  });

  it("changes when a description changes", () => {
    const changed = [{ ...manifest.tools[0], description: "List all" }, manifest.tools[1]];
    expect(hashTools(normalizeTools(changed))).not.toBe(hashTools(normalizeTools(manifest.tools)));
  });
});

describe("summaries", () => {
  it("takes the first sentence of the instructions", () => {
    expect(summaryFromInstructions("# Bank\n\n- Reads accounts and balances. Use it.")).toBe(
      "Reads accounts and balances.",
    );
    expect(summaryFromInstructions("Reads accounts and balances. Use it for money.")).toBe(
      "Reads accounts and balances.",
    );
    expect(summaryFromInstructions("   \n  ")).toBeNull();
  });

  it("truncates at a word boundary", () => {
    const out = truncate("word ".repeat(100), 30);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out.endsWith("word…")).toBe(true);
  });

  it("falls back to the first tool names", () => {
    const tools = ["a", "b", "c", "d", "e", "f"].map((name) => ({ name }));
    expect(heuristicSummary("x", tools)).toBe("Tools: a, b, c, d and 2 more");
    expect(heuristicSummary("x", [])).toBe("x: no tools listed");
  });
});

describe("refreshServerCatalog", () => {
  it("writes a full entry with a heuristic summary when there are no instructions", async () => {
    const { d, written } = deps();
    const entry = await refreshServerCatalog(server, d);
    expect(written).toEqual([entry]);
    expect(entry).toMatchObject({
      serverId: "s1",
      toolCount: 2,
      summarySource: "heuristic",
      summary: "Tools: balance, list_transactions",
    });
    expect(entry.tools.map((t) => t.name)).toEqual(["balance", "list_transactions"]);
    expect(entry.schemaTokens).toBeGreaterThan(0);
  });

  it("prefers the server's instructions", async () => {
    const { d } = deps({
      fetchManifest: async () => ({ ...manifest, instructions: "Bank data." }),
    });
    expect(await refreshServerCatalog(server, d)).toMatchObject({
      summary: "Bank data.",
      summarySource: "instructions",
    });
  });

  it("only bumps refreshedAt when the tool list is unchanged", async () => {
    const first = await refreshServerCatalog(server, deps().d);
    const { d, written } = deps({ now: () => new Date("2026-11-01T00:00:00Z") }, first);
    const second = await refreshServerCatalog(server, d);
    expect(second).toEqual({ ...first, refreshedAt: new Date("2026-11-01T00:00:00Z") });
    expect(written).toHaveLength(1);
  });

  it("calls the summarizer only when the tools changed", async () => {
    const summarize = vi.fn(async () => "Generated summary");
    const first = await refreshServerCatalog(server, deps({ summarize }).d);
    expect(first).toMatchObject({ summary: "Generated summary", summarySource: "generated" });
    await refreshServerCatalog(server, deps({ summarize }, first).d);
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  it("falls back when the summarizer fails", async () => {
    const summarize = vi.fn(async () => {
      throw new Error("model down");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const entry = await refreshServerCatalog(server, deps({ summarize }).d);
    expect(entry.summarySource).toBe("heuristic");
  });

  it("throws on a connection failure and writes nothing", async () => {
    const { d, written } = deps({
      fetchManifest: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    await expect(refreshServerCatalog(server, d)).rejects.toThrow("ECONNREFUSED");
    expect(written).toEqual([]);
  });
});
