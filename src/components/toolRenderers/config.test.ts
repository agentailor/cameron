import { describe, it, expect } from "vitest";
import { TOOL_RENDERERS, renderersFor } from "./config";
import { listCapabilities } from "@/lib/agent/capabilities";

/**
 * The catalog is keyed on tool names, so a rename in a tool module would silently drop that tool
 * back to the JSON fallback with nothing failing. These tests are the drift guard — the same job
 * `capabilities.test.ts` does for the CSV entries.
 */
describe("TOOL_RENDERERS", () => {
  const realNames = new Set(listCapabilities().map((c) => c.name));

  it("only names tools that are actually registered", () => {
    const unknown = Object.keys(TOOL_RENDERERS).filter((n) => !realNames.has(n));
    expect(unknown).toEqual([]);
  });

  it("covers every built-in tool", () => {
    const uncovered = [...realNames].filter((n) => !(n in TOOL_RENDERERS));
    expect(uncovered).toEqual([]);
  });

  it("falls back to json for unlisted tools (MCP and anything new)", () => {
    expect(renderersFor("some_mcp_server__do_thing")).toEqual({ args: "json", result: "json" });
    expect(renderersFor(undefined)).toEqual({ args: "json", result: "json" });
  });

  it("routes run_sql arguments to the sql renderer", () => {
    expect(renderersFor("run_sql").args).toBe("sql");
  });

  it("gives every mutating tool a receipt", () => {
    for (const name of ["log_expense", "create_category", "import_transactions_csv"]) {
      expect(renderersFor(name).result).toBe("receipt");
    }
  });
});
