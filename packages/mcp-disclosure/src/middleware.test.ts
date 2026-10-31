import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgent, tool } from "langchain";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ChatResult } from "@langchain/core/outputs";
import { MemorySaver } from "@langchain/langgraph";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { mcpServerDisclosureMiddleware, MAX_LOAD_LIMIT } from "./middleware";
import { makeServer } from "./testing";
import type { DisclosureOptions, DisclosureServer, ResolveMcpTool } from "./types";

type State = { activeTools: string[] };
type Step = { tools?: [string, Record<string, unknown>][]; text?: string };

/** Plays a script of tool calls and records what each model call was shown. */
class ScriptedModel extends BaseChatModel {
  seen: { tools: string[]; system: string }[] = [];
  private bound: string[] = [];
  private n = 0;

  constructor(private script: Step[]) {
    super({});
  }

  _llmType() {
    return "scripted";
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bindTools(tools: any[]): any {
    this.bound = tools.map((t) => t.name);
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const system = messages.find((m) => m.getType() === "system");
    this.seen.push({ tools: [...this.bound], system: system?.text ?? "" });
    const step = this.script.shift() ?? { text: "done" };
    const id = `m${++this.n}`;
    const message = new AIMessage({
      id,
      content: step.text ?? "",
      tool_calls: (step.tools ?? []).map(([name, args], i) => ({
        id: `${id}-c${i}`,
        name,
        args,
        type: "tool_call" as const,
      })),
    });
    return { generations: [{ message, text: step.text ?? "" }] };
  }
}

const calls: string[] = [];
const fakeTool = (name: string) =>
  tool(
    async () => {
      calls.push(name);
      return `${name} ok`;
    },
    { name, description: `fake ${name}`, schema: z.object({}) },
  );

const servers: DisclosureServer[] = [
  makeServer("bank", { toolNames: ["list_transactions", "get_balance"] }),
  makeServer("notes", { toolNames: ["search_notes"] }),
  // Its OAuth token expired: still listed, but load_tools never loads its tools.
  makeServer("files", { toolNames: ["read_file", "search_files"], authRequired: true }),
];
const CORE = ["load_tools", "log_expense"];

/** Server ids in the order a tool from them was resolved — i.e. "connected". */
const connected: string[] = [];
const fakeResolver: ResolveMcpTool = async (serverId, name) => {
  connected.push(serverId);
  const server = servers.find((s) => s.id === serverId)!;
  return { ok: true, tool: fakeTool(`${server.name}__${name}`) };
};

function build(
  script: Step[],
  {
    options = {},
    resolveTool = fakeResolver,
    using = servers,
  }: {
    options?: Partial<DisclosureOptions>;
    resolveTool?: ResolveMcpTool;
    using?: DisclosureServer[];
  } = {},
) {
  const model = new ScriptedModel(script);
  const log = vi.fn();
  const agent = createAgent({
    model,
    // Only core tools are registered; MCP tools come from the catalog and the resolver.
    tools: [fakeTool("log_expense")],
    systemPrompt: "You are Cameron.",
    checkpointer: new MemorySaver(),
    middleware: [mcpServerDisclosureMiddleware({ servers: using, resolveTool, options, log })],
  });
  const run = (thread: string, content = "hi") =>
    agent.invoke(
      { messages: [{ role: "user", content }] },
      { configurable: { thread_id: thread } },
    );
  // The agent's own getState is typed `never` once middleware state is merged in.
  const stateOf = async (thread: string) =>
    (
      await (agent as unknown as { getState: (c: object) => Promise<{ values: State }> }).getState({
        configurable: { thread_id: thread },
      })
    ).values;
  return { model, run, log, stateOf };
}

const toolResult = (out: { messages: BaseMessage[] }) =>
  JSON.parse(String(out.messages.find((m) => m.getType() === "tool")!.content));

beforeEach(() => {
  calls.length = 0;
  connected.length = 0;
});

describe("disclosure", () => {
  it("first call sees core tools and load_tools only, plus the capability list", async () => {
    const { model, run, log } = build([]);
    await run("t1");
    expect(model.seen[0].tools.sort()).toEqual(CORE);
    expect(model.seen[0].system).toContain("You are Cameron.");
    expect(model.seen[0].system).toContain("- bank: bank tools");
    expect(model.seen[0].system).toContain("- files (sign-in required)");
    expect(log.mock.calls[0][0]).toMatch(/loaded=0\/5 tools=2/);
  });

  it("offers neither load_tools nor the list when no server is available", async () => {
    const gone = { ...makeServer("gone"), catalog: null };
    for (const using of [[], [gone]]) {
      const { model, run } = build([], { using });
      await run("t1");
      expect(model.seen[0].tools).toEqual(["log_expense"]);
      expect(model.seen[0].system).toBe("You are Cameron.");
    }
  });

  it("loads only the tools that match, from the next step on", async () => {
    const { model, run, stateOf } = build([
      { tools: [["load_tools", { query: "transactions" }]] },
      { tools: [["bank__list_transactions", {}]] },
      { text: "Here they are" },
    ]);
    await run("t1", "show my last 5 transactions");
    expect(model.seen[0].tools).not.toContain("bank__list_transactions");
    expect(model.seen[1].tools).toContain("bank__list_transactions");
    expect(model.seen[1].tools).not.toContain("bank__get_balance");
    expect(calls).toEqual(["bank__list_transactions"]);
    expect((await stateOf("t1")).activeTools).toEqual(["bank__list_transactions"]);
  });

  it("appends in load order, so the existing tools stay a stable prefix", async () => {
    const { model, run } = build([
      { tools: [["load_tools", { query: "balance" }]] },
      { tools: [["load_tools", { query: "notes" }]] },
    ]);
    await run("t1");
    const before = model.seen[1].tools;
    const after = model.seen[2].tools;
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length)).toEqual(["notes__search_notes"]);
  });

  it("keeps loaded tools across turns of a thread, but not in a new thread", async () => {
    const { model, run } = build([{ tools: [["load_tools", { query: "notes" }]] }]);
    await run("t1");
    const before = model.seen.length;
    await run("t1");
    expect(model.seen[before].tools).toContain("notes__search_notes");
    await run("t2");
    expect(model.seen.at(-1)!.tools.sort()).toEqual(CORE);
  });

  it("load_tools itself returns plain JSON, never a Command (the chat UI streams it raw)", async () => {
    const [loadTools] = mcpServerDisclosureMiddleware({ servers, resolveTool: fakeResolver })
      .tools as unknown as StructuredToolInterface[];
    const raw = await loadTools.invoke({ query: "balance" });
    expect(typeof raw).toBe("string");
    expect(JSON.parse(raw as string)).toEqual({
      ok: true,
      loaded: [{ name: "bank__get_balance", description: "fake get_balance" }],
      alreadyLoaded: [],
      matched: 1,
    });
  });

  it("applies two loads made in the same step", async () => {
    const { run, stateOf } = build([
      {
        tools: [
          ["load_tools", { query: "balance" }],
          ["load_tools", { query: "notes" }],
        ],
      },
    ]);
    await run("t1");
    expect((await stateOf("t1")).activeTools.sort()).toEqual([
      "bank__get_balance",
      "notes__search_notes",
    ]);
  });

  it("reports a repeat load as already loaded and adds nothing", async () => {
    const { run, stateOf } = build([
      { tools: [["load_tools", { query: "balance" }]] },
      { tools: [["load_tools", { query: "balance" }]] },
    ]);
    const out = await run("t1");
    const results = out.messages.filter((m) => m.getType() === "tool");
    expect(JSON.parse(String(results[1].content))).toMatchObject({
      loaded: [],
      alreadyLoaded: ["bank__get_balance"],
    });
    expect((await stateOf("t1")).activeTools).toEqual(["bank__get_balance"]);
  });

  it("loads only the named tool for an exact name, prefixed or not", async () => {
    const many = [makeServer("big", { toolNames: ["get_a", "get_b", "get_c"] })];
    for (const query of ["big__get_b", "get_b"]) {
      const { run, stateOf } = build([{ tools: [["load_tools", { query }]] }], { using: many });
      await run(query);
      expect((await stateOf(query)).activeTools).toEqual(["big__get_b"]);
    }
  });

  it("respects limit, caps it, and reports how many matched", async () => {
    const names = Array.from({ length: 15 }, (_, i) => `get_${String(i).padStart(2, "0")}`);
    const many = [makeServer("big", { toolNames: names })];
    for (const [limit, loaded] of [
      [undefined, 5],
      [2, 2],
      [99, MAX_LOAD_LIMIT],
    ] as const) {
      const { run } = build([{ tools: [["load_tools", { query: "get", limit }]] }], {
        using: many,
      });
      const result = toolResult(await run("t1"));
      expect(result.loaded).toHaveLength(loaded);
      expect(result.matched).toBe(15);
    }
  });

  it("searches one server when asked, and rejects an unknown one with the valid names", async () => {
    const scoped = build([{ tools: [["load_tools", { query: "get", server: "notes" }]] }]);
    expect(toolResult(await scoped.run("t1"))).toMatchObject({ matched: 0, loaded: [] });

    const { run } = build([{ tools: [["load_tools", { query: "x", server: "revolut" }]] }]);
    expect(toolResult(await run("t1"))).toMatchObject({
      ok: false,
      error: "unknown_server",
      availableServers: ["bank", "files", "notes"],
    });
  });

  it("answers no match with tool names to retry with, hiding servers needing sign-in", async () => {
    const { run, stateOf } = build([{ tools: [["load_tools", { query: "kubernetes" }]] }]);
    const result = toolResult(await run("t1"));
    expect(result).toMatchObject({ ok: true, loaded: [], matched: 0 });
    expect(result.toolNames).toEqual({
      bank: ["list_transactions", "get_balance"],
      notes: ["search_notes"],
    });
    expect((await stateOf("t1")).activeTools).toEqual([]);
  });

  it("refuses when only a server needing sign-in matches, and loads nothing", async () => {
    const { run, stateOf } = build([{ tools: [["load_tools", { query: "read_file" }]] }]);
    const result = toolResult(await run("t1"));
    expect(result).toMatchObject({ ok: false, error: "auth_required", server: "files" });
    expect(result.message).toContain("Connections page");
    expect((await stateOf("t1")).activeTools).toEqual([]);
  });

  it("loads usable matches and names the server needing sign-in when both match", async () => {
    const { run, stateOf } = build([{ tools: [["load_tools", { query: "search" }]] }]);
    const result = toolResult(await run("t1"));
    expect(result.loaded.map((t: { name: string }) => t.name)).toEqual(["notes__search_notes"]);
    expect(result.signInRequired[0].server).toBe("files");
    expect((await stateOf("t1")).activeTools).toEqual(["notes__search_notes"]);
  });

  it("auto-loads a catalog tool called before it was loaded", async () => {
    const { model, run, stateOf } = build([{ tools: [["notes__search_notes", {}]] }]);
    await run("t1");
    expect(calls).toEqual(["notes__search_notes"]);
    expect(model.seen[1].tools).toContain("notes__search_notes");
    expect((await stateOf("t1")).activeTools).toEqual(["notes__search_notes"]);
  });

  it("refuses an unloaded tool when auto-load is off", async () => {
    const { run } = build([{ tools: [["notes__search_notes", {}]] }], {
      options: { autoLoadOnCall: false },
    });
    const result = toolResult(await run("t1"));
    expect(calls).toEqual([]);
    expect(result).toMatchObject({ ok: false, error: "tool_not_loaded" });
  });

  it("drops a loaded tool whose server is no longer available", async () => {
    const checkpointer = new MemorySaver();
    const make = (using: DisclosureServer[], model: ScriptedModel) =>
      createAgent({
        model,
        tools: [fakeTool("log_expense")],
        checkpointer,
        middleware: [
          mcpServerDisclosureMiddleware({
            servers: using,
            resolveTool: fakeResolver,
            log: vi.fn(),
          }),
        ],
      });
    const config = { configurable: { thread_id: "t1" } };
    const input = { messages: [{ role: "user", content: "hi" }] };
    const first = new ScriptedModel([{ tools: [["load_tools", { query: "notes" }]] }]);
    await make(servers, first).invoke(input, config);
    expect(first.seen.at(-1)!.tools).toContain("notes__search_notes");

    const second = new ScriptedModel([]);
    await make([servers[0]], second).invoke(input, config);
    expect(second.seen[0].tools).not.toContain("notes__search_notes");
  });
});

describe("connecting on demand", () => {
  it("connects to nothing when no MCP tool is called", async () => {
    await build([{ tools: [["load_tools", { query: "balance" }]] }]).run("t1");
    expect(connected).toEqual([]);
  });

  it("connects only to the server whose tool is called", async () => {
    const { run } = build([
      {
        tools: [
          ["load_tools", { query: "transactions" }],
          ["load_tools", { query: "notes" }],
        ],
      },
      { tools: [["bank__list_transactions", {}]] },
    ]);
    await run("t1");
    expect(connected).toEqual(["id-bank"]);
    expect(calls).toEqual(["bank__list_transactions"]);
  });

  it("reports a connection failure as an error result and does not auto-load", async () => {
    const failing: ResolveMcpTool = async () => ({
      ok: false,
      error: "connect_failed",
      message: "spawn ENOENT",
    });
    const { run, stateOf } = build([{ tools: [["notes__search_notes", {}]] }], {
      resolveTool: failing,
    });
    expect(toolResult(await run("t1"))).toMatchObject({ ok: false, error: "connect_failed" });
    expect((await stateOf("t1")).activeTools).toEqual([]);
  });

  it("tells the model to ask for a reconnect when a token expired mid-thread", async () => {
    const expired: ResolveMcpTool = async () => ({
      ok: false,
      error: "auth_required",
      message: "Connect this server with OAuth first.",
    });
    const { run } = build([{ tools: [["notes__search_notes", {}]] }], { resolveTool: expired });
    const result = toolResult(await run("t1"));
    expect(result).toMatchObject({ ok: false, error: "auth_required" });
    expect(result.message).toContain("Connections page");
  });

  it("refuses a tool the catalog does not list, without connecting", async () => {
    const { run } = build([{ tools: [["bank__drop_tables", {}]] }]);
    expect(toolResult(await run("t1"))).toMatchObject({ error: "unknown_tool" });
    expect(connected).toEqual([]);
  });
});
