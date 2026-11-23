import { beforeEach, describe, expect, it, vi } from "vitest";
import { callTool } from "./testing";
import type { Memory } from "@/types/memory";

/** Contract tests for the memory tools — repository stubbed. See docs/TESTING.md. */

vi.mock("@/lib/repositories/memoryRepository", () => ({
  list: vi.fn(),
  getMany: vi.fn(),
  getByTitle: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  removeMany: vi.fn(),
}));

const repo = await import("@/lib/repositories/memoryRepository");
const {
  remember,
  createRecall,
  forget,
  memoryIndex,
  MEMORY_LIMIT,
  MEMORY_TITLE_MAX,
  MEMORY_CONTENT_MAX,
} = await import("./memory");

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  const at = new Date("2026-11-01T00:00:00.000Z");
  return {
    id: "m-1",
    title: "grocery totals: Costco counts as groceries",
    content: "Count Costco purchases under Courses.",
    sourceThreadId: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

const COSTCO = {
  title: "grocery totals: Costco counts as groceries",
  content: "Count Costco purchases under Courses.",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(repo.count).mockResolvedValue(0);
});

describe("remember", () => {
  it("saves a memory with the thread it came from", async () => {
    vi.mocked(repo.create).mockResolvedValue({ ok: true, memory: makeMemory() });

    const raw = await remember.invoke(COSTCO, { configurable: { thread_id: "t-1" } });

    expect(JSON.parse(raw as string)).toMatchObject({
      ok: true,
      replaced: false,
      memory: { id: "m-1", title: COSTCO.title },
    });
    expect(repo.create).toHaveBeenCalledWith({ ...COSTCO, sourceThreadId: "t-1" });
  });

  it("trims what it stores", async () => {
    vi.mocked(repo.create).mockResolvedValue({ ok: true, memory: makeMemory() });

    await callTool(remember, { title: `  ${COSTCO.title} `, content: ` ${COSTCO.content}\n` });

    expect(repo.create).toHaveBeenCalledWith({ ...COSTCO, sourceThreadId: null });
  });

  /** A duplicate must point at the memory to replace, or the agent saves a near-copy. */
  it("returns the existing memory on a duplicate title, with how to replace it", async () => {
    const existing = makeMemory({ id: "m-9" });
    vi.mocked(repo.create).mockResolvedValue({ ok: false, reason: "duplicate_title", existing });

    const res = await callTool(remember, COSTCO);

    expect(res).toMatchObject({
      ok: false,
      error: "duplicate_title",
      existing: { id: "m-9", content: existing.content },
    });
    expect(res.message).toContain('replaces: "m-9"');
  });

  it("refuses at the limit, writing nothing and saying so", async () => {
    vi.mocked(repo.count).mockResolvedValue(MEMORY_LIMIT);

    const res = await callTool(remember, COSTCO);

    expect(res).toMatchObject({ ok: false, error: "memory_full", saved: MEMORY_LIMIT });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it.each([
    ["a blank title", { title: "   ", content: "x" }],
    ["blank content", { title: "t", content: "" }],
    ["a long title", { title: "t".repeat(MEMORY_TITLE_MAX + 1), content: "x" }],
    ["long content", { title: "t", content: "c".repeat(MEMORY_CONTENT_MAX + 1) }],
  ])("returns a correctable error for %s", async (_label, input) => {
    const res = await callTool(remember, input);

    expect(res).toMatchObject({ ok: false, error: "invalid_input" });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("replaces a memory in place, even at the limit", async () => {
    vi.mocked(repo.count).mockResolvedValue(MEMORY_LIMIT);
    vi.mocked(repo.update).mockResolvedValue({ ok: true, memory: makeMemory({ id: "m-3" }) });

    const res = await callTool(remember, { ...COSTCO, replaces: "m-3" });

    expect(res).toMatchObject({ ok: true, replaced: true, memory: { id: "m-3" } });
    expect(repo.update).toHaveBeenCalledWith("m-3", COSTCO);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("reports an unknown `replaces` id without saving a new memory", async () => {
    vi.mocked(repo.update).mockResolvedValue({ ok: false, reason: "not_found" });

    const res = await callTool(remember, { ...COSTCO, replaces: "nope" });

    expect(res).toMatchObject({ ok: false, error: "not_found" });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("reports a replacement whose title another memory holds", async () => {
    const existing = makeMemory({ id: "m-2" });
    vi.mocked(repo.update).mockResolvedValue({ ok: false, reason: "duplicate_title", existing });

    const res = await callTool(remember, { ...COSTCO, replaces: "m-3" });

    expect(res).toMatchObject({ ok: false, error: "duplicate_title", existing: { id: "m-2" } });
  });
});

describe("recall", () => {
  it("lists every saved memory's id and title in its description", () => {
    const recall = createRecall([
      { id: "m-1", title: "grocery totals: Costco counts as groceries" },
      { id: "m-2", title: "payday: paid on the 25th" },
    ]);

    expect(recall.description).toContain("- m-1 · grocery totals: Costco counts as groceries");
    expect(recall.description).toContain("- m-2 · payday: paid on the 25th");
  });

  it("says so when nothing is saved, rather than listing nothing", () => {
    expect(createRecall([]).description).toContain("No memories are saved yet.");
    expect(memoryIndex([])).toBe("No memories are saved yet.");
  });

  it("returns content and names missing ids instead of dropping them", async () => {
    vi.mocked(repo.getMany).mockResolvedValue([makeMemory()]);

    const res = await callTool(createRecall([]), { ids: ["m-1", "m-404", "m-1"] });

    expect(res).toMatchObject({
      memories: [{ id: "m-1", content: "Count Costco purchases under Courses." }],
      missing: ["m-404"],
    });
    expect(res.hint).toBeTruthy();
    expect(repo.getMany).toHaveBeenCalledWith(["m-1", "m-404"]);
  });

  it("gives no hint when everything was found", async () => {
    vi.mocked(repo.getMany).mockResolvedValue([makeMemory()]);

    const res = await callTool(createRecall([]), { ids: ["m-1"] });

    expect(res.missing).toEqual([]);
    expect(res).not.toHaveProperty("hint");
  });
});

describe("forget", () => {
  it("is an error when nothing matched, so it isn't announced as a deletion", async () => {
    vi.mocked(repo.removeMany).mockResolvedValue([]);

    const res = await callTool(forget, { ids: ["m-404"] });

    expect(res).toMatchObject({ ok: false, error: "not_found", missing: ["m-404"] });
  });

  it("reports what was deleted and what didn't exist", async () => {
    vi.mocked(repo.removeMany).mockResolvedValue([{ id: "m-1", title: "payday: the 25th" }]);

    const res = await callTool(forget, { ids: ["m-1", "m-404"] });

    expect(res).toEqual({
      ok: true,
      forgotten: [{ id: "m-1", title: "payday: the 25th" }],
      missing: ["m-404"],
    });
  });
});

/** Deliberate (docs/MEMORY.md): memories change what Cameron knows, not the records. */
describe("approval", () => {
  it("is not required for any memory tool", async () => {
    const { isGatedTool } = await import("../gatedTools");
    for (const name of ["remember", "recall", "forget"])
      expect(isGatedTool(name), name).toBe(false);
  });
});
