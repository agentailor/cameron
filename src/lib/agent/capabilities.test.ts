import { describe, expect, it, vi } from "vitest";
import { listCapabilities, MUTATING_TOOL_NAMES } from "./capabilities";

/**
 * The /capabilities page is only honest if it matches the tools actually registered. Most groups
 * are derived from the real arrays, so they can't drift. The CSV entries are transcribed by hand
 * (see the note in capabilities.ts) — this test pins them to the real tools so a renamed or added
 * CSV tool fails here instead of silently misinforming the user.
 */

// csvImport imports the S3 client, which throws at module load without credentials.
vi.mock("@/lib/storage/content", () => ({ extractTextContent: vi.fn() }));

const { csvImportTools } = await import("./tools/csvImport");

describe("listCapabilities", () => {
  it("exposes every built-in tool with a usable description", () => {
    const caps = listCapabilities();
    expect(caps.length).toBeGreaterThan(0);
    for (const c of caps) {
      expect(c.name, "name").toBeTruthy();
      expect(c.description.length, `description for ${c.name}`).toBeGreaterThan(20);
      expect(c.group, `group for ${c.name}`).toBeTruthy();
    }
  });

  it("flags exactly the gated tools as needing approval", () => {
    const gated = listCapabilities()
      .filter((c) => c.mutating)
      .map((c) => c.name)
      .sort();
    expect(gated).toEqual([...MUTATING_TOOL_NAMES].sort());
  });

  it("lists the same CSV tools the agent registers", () => {
    const listed = listCapabilities()
      .filter((c) => c.group === "CSV import")
      .map((c) => c.name)
      .sort();
    expect(listed).toEqual(csvImportTools.map((t) => t.name).sort());
  });

  it("names only tools that exist", () => {
    const names = new Set(listCapabilities().map((c) => c.name));
    for (const gated of MUTATING_TOOL_NAMES) {
      expect(names, `${gated} is gated but not listed`).toContain(gated);
    }
  });
});
