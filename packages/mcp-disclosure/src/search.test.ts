import { describe, expect, it } from "vitest";
import { createToolSearchIndex, tokenize } from "./search";
import { makeServer } from "./testing";
import type { DisclosureServer, McpToolDefinition } from "./types";

function server(name: string, tools: McpToolDefinition[]): DisclosureServer {
  const base = makeServer(name);
  return { ...base, catalog: { ...base.catalog!, tools, toolCount: tools.length } };
}

const notion = server("notionApi", [
  { name: "API-post-search", description: "Search by title" },
  {
    name: "API-post-page",
    description: "Create a page",
    inputSchema: {
      type: "object",
      properties: { parent: { anyOf: [{ $ref: "#/$defs/Parent" }] } },
      $defs: {
        Parent: { properties: { database_id: { description: "The database to add the row to" } } },
      },
    },
  },
  { name: "API-delete-a-block", description: "Delete a block" },
]);
const bank = server("bank", [
  { name: "get_balance", description: "Current balance of an account" },
  { name: "list_transactions", description: "Recent transactions for an account" },
]);
const index = createToolSearchIndex([notion, bank]);
const names = (query: string, serverId?: string) =>
  index.search(query, serverId).map((t) => t.name);

describe("tokenize", () => {
  it("splits case and punctuation, folds plurals, drops stop words", () => {
    expect(tokenize("API-post-search")).toEqual(["api", "post", "search"]);
    expect(tokenize("getBalance")).toEqual(["get", "balance"]);
    expect(tokenize("the Transactions in my class")).toEqual(["transaction", "class"]);
  });
});

describe("createToolSearchIndex", () => {
  it("finds a tool by a word in its name or description", () => {
    expect(names("search")[0]).toBe("notionApi__API-post-search");
    expect(names("what is my balance")[0]).toBe("bank__get_balance");
  });

  it("matches argument names and descriptions nested in $defs and anyOf", () => {
    expect(names("database_id")).toEqual(["notionApi__API-post-page"]);
    expect(names("row")).toEqual(["notionApi__API-post-page"]);
  });

  it("weights the tool name above other fields", () => {
    const tied = createToolSearchIndex([
      server("s", [
        { name: "aaa", description: "export the report" },
        { name: "export", description: "the report" },
      ]),
    ]);
    expect(tied.search("export")[0].definition.name).toBe("export");
  });

  it("finds nothing for unrelated or stop-word-only queries", () => {
    expect(names("kubernetes")).toEqual([]);
    expect(names("the of in")).toEqual([]);
  });

  it("can be limited to one server", () => {
    expect(names("account", bank.id)).toHaveLength(2);
    expect(names("account", notion.id)).toEqual([]);
  });

  it("breaks ties by name, so a query always gives the same order", () => {
    const tied = createToolSearchIndex([
      server("s", [
        { name: "b", description: "same words" },
        { name: "a", description: "same words" },
      ]),
    ]);
    expect(tied.search("words").map((t) => t.name)).toEqual(["s__a", "s__b"]);
  });

  it("skips servers with no catalog row", () => {
    const empty = createToolSearchIndex([{ ...makeServer("gone"), catalog: null }]);
    expect(empty.search("anything")).toEqual([]);
  });
});
