import { readFile } from "node:fs/promises";
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

  /**
   * A tool array that isn't spread into `builtin` is never bound to the agent, and nothing else
   * catches it: the arrays are all `StructuredToolInterface[]`, so a mix-up typechecks, and this
   * page still lists the tools either way. `index.ts` can't be imported here (it pulls in `pg`),
   * so this reads the source instead.
   */
  it("registers every capability group in the agent's builtin tools", async () => {
    const src = await readFile(new URL("./index.ts", import.meta.url), "utf8");
    const builtin = src.slice(
      src.indexOf("const builtin = ["),
      src.indexOf("];", src.indexOf("const builtin = [")),
    );

    const groups = ["financeTools", "csvImportTools", "analyticsTools", "categoryTools"];
    for (const g of groups) {
      expect(builtin, `${g} is not spread into builtin`).toContain(`...${g}`);
    }
    // ./tools/config is imported under an ALIAS because of the collision above, and it is the
    // alias that must feed `builtin` — spreading the shadowed local name is the bug this pins.
    const aliasImport = new RegExp(String.raw`configTools as (\w+) \} from "\./tools/config"`).exec(
      src,
    );
    expect(aliasImport, "./tools/config must be imported under an alias").not.toBeNull();
    expect(builtin, "config tools are not spread into builtin").toContain(`...${aliasImport![1]}`);
  });

  it("names only tools that exist", () => {
    const names = new Set(listCapabilities().map((c) => c.name));
    for (const gated of MUTATING_TOOL_NAMES) {
      expect(names, `${gated} is gated but not listed`).toContain(gated);
    }
  });
});
