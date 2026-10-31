import { describe, expect, it } from "vitest";
import { createToolServerIndex, findServer, renderCatalogBlock } from "./policy";
import { makeServer } from "./testing";

describe("renderCatalogBlock", () => {
  it("sorts by name and marks servers needing sign-in, whatever the input order", () => {
    const zeta = makeServer("zeta", { tools: 1, summary: "Last" });
    const alpha = makeServer("alpha", { tools: 12, summary: "First", authRequired: true });
    const block = renderCatalogBlock([zeta, alpha]);
    expect(block).toBe(
      [
        "Additional capabilities are available. Call load_tools with a short description of what you need before using them.",
        "- alpha (sign-in required): First",
        "- zeta: Last",
      ].join("\n"),
    );
    expect(renderCatalogBlock([alpha, zeta])).toBe(block);
  });

  it("prefers the owner's description over the catalog summary", () => {
    const bank = { ...makeServer("bank", { summary: "Generated" }), description: "My bank" };
    expect(renderCatalogBlock([bank])).toContain("- bank: My bank");
    expect(renderCatalogBlock([{ ...bank, description: "" }])).toContain("- bank: Generated");
  });

  it("leaves out servers with no catalog row", () => {
    const block = renderCatalogBlock([
      makeServer("kept"),
      { ...makeServer("gone"), catalog: null },
    ]);
    expect(block).not.toContain("gone");
  });

  it("is null with nothing to offer", () => {
    expect(renderCatalogBlock([])).toBeNull();
    expect(renderCatalogBlock([{ ...makeServer("gone"), catalog: null }])).toBeNull();
  });
});

describe("createToolServerIndex", () => {
  const servers = [makeServer("bank"), makeServer("bank__eu"), makeServer("notes")];
  const serverOf = createToolServerIndex(servers);

  it("maps a prefixed tool name back to its server", () => {
    expect(serverOf("notes__search")?.name).toBe("notes");
  });

  it("prefers the longest matching name", () => {
    expect(serverOf("bank__eu__balance")?.name).toBe("bank__eu");
    expect(serverOf("bank__balance")?.name).toBe("bank");
  });

  it("returns null for tools that are not MCP tools", () => {
    expect(serverOf("log_expense")).toBeNull();
    expect(serverOf("bankbalance")).toBeNull();
  });
});

describe("findServer", () => {
  it("accepts the name or the id", () => {
    const servers = [makeServer("bank")];
    expect(findServer(servers, " bank ")?.id).toBe("id-bank");
    expect(findServer(servers, "id-bank")?.name).toBe("bank");
    expect(findServer(servers, "nope")).toBeUndefined();
  });
});
