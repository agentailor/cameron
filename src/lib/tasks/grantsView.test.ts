import { describe, expect, it } from "vitest";
import { grantRefusal, toGrantsView, withServers } from "./grantsView";

const servers = [
  {
    server: "gmail",
    serverId: "srv-gmail",
    tools: [
      { tool: "gmail_search", name: "search", readOnly: true },
      { tool: "gmail_send", name: "send", readOnly: null },
    ],
  },
];

const view = (granted: string[], suggested: string[] = []) =>
  toGrantsView({ task: "creep", granted, suggested, servers });

describe("toGrantsView", () => {
  it("lists every built-in write, the hard delete as never grantable", () => {
    const v = view(["log_expense"]);
    expect(v.builtIn.find((t) => t.tool === "log_expense")).toMatchObject({
      risk: "adds",
      grantable: true,
      granted: true,
    });
    expect(v.builtIn.find((t) => t.tool === "delete_transaction")).toMatchObject({
      risk: null,
      grantable: false,
      granted: false,
    });
  });

  it("lists each server's tools with the grant, the suggestion and the read-only claim", () => {
    const v = view(["gmail_search"], ["gmail_send"]);
    expect(v.servers[0].tools).toEqual([
      { tool: "gmail_search", name: "search", readOnly: true, granted: true, suggested: false },
      { tool: "gmail_send", name: "send", readOnly: null, granted: false, suggested: true },
    ]);
  });

  it("keeps granted or suggested tools no server lists now, but not built-in reads", () => {
    const v = view(["slack_post"], ["notion_search", "run_sql"]);
    expect(v.missing).toEqual([
      { tool: "notion_search", granted: false, suggested: true },
      { tool: "slack_post", granted: true, suggested: false },
    ]);
  });
});

describe("grantRefusal", () => {
  const v = view([]);

  it("allows a listed built-in write or server tool", () => {
    expect(grantRefusal("log_expense", v, new Set())).toBeNull();
    expect(grantRefusal("gmail_send", v, new Set())).toBeNull();
  });

  it("refuses the hard delete, a tool that already runs, and an unknown tool", () => {
    expect(grantRefusal("delete_transaction", v, new Set())).toMatch(/hard delete/);
    expect(grantRefusal("run_sql", v, new Set())).toMatch(/already runs/);
    expect(grantRefusal("slack_post", v, new Set())).toMatch(/isn't a tool/);
  });

  it("keeps an unlisted tool that was already granted (a server turned off for now)", () => {
    expect(grantRefusal("slack_post", v, new Set(["slack_post"]))).toBeNull();
  });
});

describe("withServers", () => {
  it("ties a server tool to the server listing it, Cameron's tools to none", () => {
    expect(withServers(["gmail_search", "log_expense"], servers, [])).toEqual([
      { tool: "gmail_search", serverId: "srv-gmail" },
      { tool: "log_expense", serverId: null },
    ]);
  });

  it("keeps the server of a tool granted while its server is off", () => {
    const existing = [{ tool: "slack_post", serverId: "srv-slack" }];
    expect(withServers(["slack_post"], servers, existing)).toEqual(existing);
  });

  it("a server listing the tool now wins over an older record", () => {
    const existing = [{ tool: "gmail_search", serverId: "srv-old" }];
    expect(withServers(["gmail_search"], servers, existing)[0].serverId).toBe("srv-gmail");
  });
});
