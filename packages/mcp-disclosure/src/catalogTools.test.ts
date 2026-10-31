import { describe, expect, it } from "vitest";
import { catalogTools, CatalogToolNotRunnable } from "./catalogTools";
import { makeServer } from "./testing";

describe("catalogTools", () => {
  const servers = [
    makeServer("bank", { toolNames: ["balance", "list"] }),
    { ...makeServer("gone"), catalog: null },
  ];

  it("builds prefixed stand-ins per cataloged server, without connecting", () => {
    const byServer = catalogTools(servers);
    expect(byServer.get("id-bank")!.map((t) => t.name)).toEqual(["bank__balance", "bank__list"]);
    expect(byServer.has("id-gone")).toBe(false);
  });

  it("passes the server's schema through untouched", () => {
    const inputSchema = {
      type: "object",
      properties: { parent: { anyOf: [{ $ref: "#/$defs/Parent" }, { type: "string" }] } },
      $defs: { Parent: { type: "object", additionalProperties: true } },
    };
    const server = makeServer("notion");
    server.catalog!.tools = [{ name: "post_page", inputSchema }];
    const [standIn] = catalogTools([server]).get("id-notion")!;
    expect(standIn.schema).toEqual(inputSchema);
  });

  it("throws if a stand-in is ever run directly", async () => {
    const [standIn] = catalogTools(servers).get("id-bank")!;
    await expect(standIn.invoke({})).rejects.toThrow(CatalogToolNotRunnable);
  });
});
