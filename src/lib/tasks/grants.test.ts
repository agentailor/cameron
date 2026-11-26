import { describe, expect, it } from "vitest";
import { GATED_TOOL_NAMES, NEVER_GRANTABLE_TOOL_NAMES, pausesFor } from "@/lib/agent/gatedTools";
import { BUILT_IN_RISK, grantInfo } from "./grants";

describe("grantInfo", () => {
  it("never lets the hard delete be granted", () => {
    expect(grantInfo("delete_transaction")).toEqual({ status: "never" });
  });

  it("lets every other built-in write be granted, with its risk shown", () => {
    expect(grantInfo("log_expense")).toEqual({ status: "grantable", risk: "adds" });
    expect(grantInfo("import_transactions_csv")).toEqual({ status: "grantable", risk: "bulk" });
  });

  it("an MCP tool is external; a built-in read already runs", () => {
    expect(grantInfo("gmail_search_messages")).toEqual({ status: "grantable", risk: "external" });
    expect(grantInfo("run_sql")).toEqual({ status: "already_runs" });
  });

  it("classifies every built-in write: a new one can't be granted without a risk", () => {
    const classified = [...Object.keys(BUILT_IN_RISK), ...NEVER_GRANTABLE_TOOL_NAMES].sort();
    expect(classified).toEqual([...GATED_TOOL_NAMES].sort());
  });
});

describe("pausesFor", () => {
  it("a granted tool runs, an ungranted one pauses", () => {
    const granted = new Set(["log_expense", "gmail_search"]);
    expect(pausesFor("log_expense", granted)).toBe(false);
    expect(pausesFor("gmail_search", granted)).toBe(false);
    expect(pausesFor("create_category", granted)).toBe(true);
  });

  it("the hard delete pauses even if granted", () => {
    expect(pausesFor("delete_transaction", new Set(["delete_transaction"]))).toBe(true);
  });
});
