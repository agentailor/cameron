import { describe, expect, it } from "vitest";
import {
  draftFromInput,
  emptyDraft,
  inputFromDraft,
  parseServerConfig,
  serializeServers,
  splitCommandLine,
  validateDraft,
  type ParseResult,
  type ServerInput,
} from "./configParse";

const stdio = (overrides: Partial<ServerInput> = {}): ServerInput => ({
  name: "files",
  type: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem"],
  env: { ROOT: "/data" },
  url: "",
  headers: {},
  ...overrides,
});

const http = (overrides: Partial<ServerInput> = {}): ServerInput => ({
  name: "docs",
  type: "http",
  command: "",
  args: [],
  env: {},
  url: "https://docs.example.com/mcp",
  headers: { Authorization: "Bearer t" },
  ...overrides,
});

const entries = (result: ParseResult) => {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.entries;
};

describe("parseServerConfig", () => {
  it("reads an mcpServers block, inferring the transport", () => {
    const result = parseServerConfig(
      JSON.stringify({
        mcpServers: {
          files: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem"],
            env: { ROOT: "/data" },
          },
          docs: { url: "https://docs.example.com/mcp", headers: { Authorization: "Bearer t" } },
        },
      }),
    );
    expect(entries(result)).toEqual([
      { name: "files", input: stdio() },
      { name: "docs", input: http() },
    ]);
  });

  it("reads VS Code's `servers` key and the legacy `transport` key", () => {
    const result = parseServerConfig(
      JSON.stringify({ servers: { files: { transport: "stdio", command: "npx" } } }),
    );
    expect(entries(result)[0]).toEqual({ name: "files", input: stdio({ args: [], env: {} }) });
  });

  it("maps streamable-http and sse to http", () => {
    for (const type of ["streamable-http", "sse"]) {
      const [entry] = entries(
        parseServerConfig(JSON.stringify({ type, url: "https://x.dev/mcp" })),
      );
      expect(entry).toMatchObject({ input: { type: "http" } });
    }
  });

  it("reads a single server object, taking `name` when present", () => {
    const [named] = entries(parseServerConfig('{"name": "files", "command": "npx"}'));
    const [unnamed] = entries(parseServerConfig('{"command": "npx"}'));
    expect(named.name).toBe("files");
    expect(unnamed.name).toBe("");
  });

  it("reads a bare name → server map", () => {
    const result = parseServerConfig('{"a": {"command": "x"}, "b": {"url": "https://b.dev"}}');
    expect(entries(result).map((e) => e.name)).toEqual(["a", "b"]);
  });

  it("reads a fragment copied out of a larger file, trailing comma included", () => {
    const result = parseServerConfig('"files": { "command": "npx", "args": ["-y",], },');
    expect(entries(result)[0]).toMatchObject({ name: "files", input: { args: ["-y"] } });
  });

  it("keeps commas inside strings", () => {
    const [entry] = entries(parseServerConfig('{"command": "a,}", "args": ["x",],}'));
    expect(entry).toMatchObject({ input: { command: "a,}", args: ["x"] } });
  });

  it("coerces scalar args and env values to strings", () => {
    const [entry] = entries(
      parseServerConfig('{"command": "x", "args": [8080, true], "env": {"N": 1}}'),
    );
    expect(entry).toMatchObject({ input: { args: ["8080", "true"], env: { N: "1" } } });
  });

  it("rejects bad entries individually, keeping the good ones", () => {
    const result = parseServerConfig(
      JSON.stringify({
        mcpServers: {
          ok: { command: "x" },
          noTarget: { args: [] },
          badType: { type: "websocket", url: "ws://x" },
          badArgs: { command: "x", args: [{ nested: true }] },
          badEnv: { command: "x", env: ["A=1"] },
        },
      }),
    );
    const byName = Object.fromEntries(entries(result).map((e) => [e.name, e]));
    expect(byName.ok).toHaveProperty("input");
    expect(byName.noTarget).toEqual({
      name: "noTarget",
      error: expect.stringContaining("command"),
    });
    expect(byName.badType).toEqual({
      name: "badType",
      error: expect.stringContaining("websocket"),
    });
    expect(byName.badArgs).toHaveProperty("error");
    expect(byName.badEnv).toHaveProperty("error");
  });

  it("reports where invalid JSON breaks", () => {
    const result = parseServerConfig('{\n  "command": "x"\n  "args": []\n}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/^Line 3, column 3: /);
  });

  it("rejects JSON that holds no server", () => {
    expect(parseServerConfig('{"theme": "dark"}').ok).toBe(false);
    expect(parseServerConfig("[]").ok).toBe(false);
    expect(parseServerConfig("   ").ok).toBe(false);
  });
});

describe("serializeServers", () => {
  it("round-trips through parseServerConfig", () => {
    const inputs = [stdio(), http()];
    const result = parseServerConfig(serializeServers(inputs));
    expect(entries(result)).toEqual(inputs.map((input) => ({ name: input.name, input })));
  });

  it("omits empty collections", () => {
    const json = JSON.parse(serializeServers([stdio({ args: [], env: {} })]));
    expect(json.mcpServers.files).toEqual({ type: "stdio", command: "npx" });
  });
});

describe("draft conversion", () => {
  it("round-trips an input through a draft", () => {
    expect(inputFromDraft(draftFromInput(stdio()))).toEqual(stdio());
    expect(inputFromDraft(draftFromInput(http()))).toEqual(http());
  });

  it("trims, drops blank rows, and clears the other transport's fields", () => {
    const draft = {
      ...draftFromInput(stdio()),
      name: " files ",
      args: ["-y", "  ", ""],
      env: [
        { key: "", value: "" },
        { key: " A ", value: "1" },
      ],
      url: "left over",
    };
    expect(inputFromDraft(draft)).toEqual(stdio({ args: ["-y"], env: { A: "1" } }));
  });
});

describe("validateDraft", () => {
  it("requires a name, and one safe for a tool prefix", () => {
    expect(validateDraft({ ...emptyDraft(), command: "x" }).name).toBeDefined();
    expect(validateDraft({ ...emptyDraft(), name: "my server", command: "x" }).name).toBeDefined();
    expect(validateDraft({ ...emptyDraft(), name: "my-server_2", command: "x" })).toEqual({});
  });

  it("flags a name that is already taken", () => {
    const errors = validateDraft({ ...emptyDraft(), name: "files", command: "x" }, ["files"]);
    expect(errors.name).toContain("already exists");
  });

  it("requires a command for stdio and an http(s) url for http", () => {
    expect(validateDraft({ ...emptyDraft(), name: "a" }).command).toBeDefined();
    const remote = { ...emptyDraft(), name: "a", type: "http" as const };
    expect(validateDraft(remote).url).toBeDefined();
    expect(validateDraft({ ...remote, url: "ftp://x" }).url).toBeDefined();
    expect(validateDraft({ ...remote, url: "https://x.dev/mcp" })).toEqual({});
  });

  it("flags duplicate and nameless env rows", () => {
    const base = { ...emptyDraft(), name: "a", command: "x" };
    const dup = [
      { key: "A", value: "1" },
      { key: "A", value: "2" },
    ];
    expect(validateDraft({ ...base, env: dup }).env).toContain("twice");
    expect(validateDraft({ ...base, env: [{ key: "", value: "1" }] }).env).toBeDefined();
  });
});

describe("splitCommandLine", () => {
  it("splits on whitespace and honors quotes", () => {
    expect(splitCommandLine(`npx -y  @scope/pkg 'a b' ""`)).toEqual([
      "npx",
      "-y",
      "@scope/pkg",
      "a b",
      "",
    ]);
  });

  it("keeps Windows backslashes, escaping only a quote", () => {
    expect(splitCommandLine(String.raw`node C:\srv\index.js "C:\My Files" "say \"hi\""`)).toEqual([
      "node",
      String.raw`C:\srv\index.js`,
      String.raw`C:\My Files`,
      'say "hi"',
    ]);
  });
});
