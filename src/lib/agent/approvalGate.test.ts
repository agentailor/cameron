import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it } from "vitest";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { MemorySaver } from "@langchain/langgraph";
import { createAgent, tool } from "langchain";
import { z } from "zod";
import {
  LOAD_TOOLS_TOOL,
  mcpServerDisclosureMiddleware,
  type DisclosureServer,
  type ResolveMcpTool,
} from "@agentailor/mcp-disclosure";
import { approvalGateMiddleware } from "./approvalGate";
import {
  GATED_TOOL_NAMES,
  LOAD_TOOLS_TOOL_NAME,
  UNGATED_TOOL_NAMES,
  requiresApproval,
} from "./gatedTools";
import {
  readPendingBatch,
  resolveDecisions,
  toResumeCommand,
  type GraphSnapshot,
} from "@/services/approvalDecisions";

/**
 * The approval gate is Cameron's first design rule: nothing mutating runs without an explicit
 * human decision. A request must therefore never be able to switch it off.
 *
 * The bypass exists for ONE caller — the eval harness, which drives the agent factory in-process
 * and has no human to answer an interrupt. These tests pin the boundary between that and
 * everything reachable over HTTP, because the failure is silent: a bypass wired back into the
 * route would still typecheck, still stream, and quietly write to a real ledger.
 *
 * Source-level assertions, in the same spirit as capabilities.test.ts — what needs pinning is
 * that a future edit doesn't reintroduce the path, which no runtime assertion observes.
 */

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf-8");

/** The eval-only flag. Named so no one mistakes it for a product setting. */
const BYPASS = "bypassApprovalForEval";

describe("the approval gate is not reachable from a request", () => {
  it("the stream route never reads an approval-bypass param", async () => {
    const route = await read("../../app/api/agent/stream/route.ts");
    expect(route).not.toContain("approveAllTools");
    expect(route).not.toContain(BYPASS);
  });

  it("the stream's public schema does not advertise one", async () => {
    // The OpenAPI doc is a contract; a documented bypass invites a client to send it.
    const schema = await read("../../app/api/agent/stream/schema.ts");
    expect(schema).not.toContain("approveAllTools");
    expect(schema).not.toContain(BYPASS);
  });

  it("the client never puts one on the wire", async () => {
    const chat = await read("../../services/chatService.ts");
    expect(chat).not.toContain("approveAllTools");
    expect(chat).not.toContain(BYPASS);
  });

  it("MessageOptions — the request-shaped type — cannot carry one", async () => {
    const types = await read("../../types/message.ts");
    expect(types).not.toContain("approveAllTools");
    expect(types).not.toContain(BYPASS);
  });

  it("agentService builds the agent without a bypass", async () => {
    // This is the seam where a request reaches the agent factory; it must not forward one.
    const service = await read("../../services/agentService.ts");
    expect(service).not.toMatch(new RegExp(`${BYPASS}\\s*:`));
    expect(service).not.toContain("approveAllTools");
  });

  it("no UI surface offers a toggle", async () => {
    for (const file of [
      "../../components/MessageInput.tsx",
      "../../components/settings/ModelSettingsForm.tsx",
      "../../app/settings/page.tsx",
    ]) {
      const src = await read(file);
      expect(src, file).not.toContain("approveAllTools");
      expect(src, file).not.toContain(BYPASS);
    }
  });

  it("the middleware is installed unless the eval flag is set", async () => {
    const factory = await read("./index.ts");
    // The gate hangs off exactly one condition, and that condition is the eval-only flag.
    expect(factory).toContain(`cfg?.${BYPASS}`);
    expect(factory).toContain("approvalGateMiddleware()");
    expect(factory).not.toContain("humanInTheLoopMiddleware");
    expect(factory).not.toContain("approveAllTools");
  });

  it("interruptOn is built from the calls, by requiresApproval", async () => {
    // A map fixed at build time misses any name absent from it, such as an MCP tool loaded later.
    const gate = await read("./approvalGate.ts");
    expect(gate).toContain("humanInTheLoopMiddleware");
    expect(gate).toContain(".filter(requiresApproval)");
    expect(GATED_TOOL_NAMES.length).toBeGreaterThan(0);
  });

  it("validation auto-approves while the import stays gated", async () => {
    const { GATED_TOOL_NAMES, isGatedTool } = await import("./gatedTools");

    expect(GATED_TOOL_NAMES).toContain("import_transactions_csv");
    expect(GATED_TOOL_NAMES).not.toContain("validate_csv_import");
    expect(GATED_TOOL_NAMES).not.toContain("read_csv_rows");
    expect(isGatedTool("validate_csv_import")).toBe(false);
    expect(isGatedTool("read_csv_rows")).toBe(false);
  });

  it("edit validators auto-approve while the edits stay gated", async () => {
    const { GATED_TOOL_NAMES, isGatedTool } = await import("./gatedTools");

    expect(GATED_TOOL_NAMES).toContain("update_transaction");
    expect(GATED_TOOL_NAMES).toContain("delete_transaction");
    expect(isGatedTool("validate_transaction_update")).toBe(false);
    expect(isGatedTool("validate_transaction_delete")).toBe(false);
  });

  it("a resume never builds its decisions by repeating one value (#45)", async () => {
    // One click used to become a decision for the whole batch. The resume must go through the
    // per-call resolver, and nothing may fill an array of decisions from a single one.
    const service = await read("../../services/agentService.ts");
    expect(service).toContain("resolveDecisions(");
    expect(service).not.toMatch(/Array\.from\(\s*\{\s*length/);
    expect(service).not.toMatch(/\.fill\(/);
    expect(service).not.toContain("allowTool");

    const route = await read("../../app/api/agent/stream/route.ts");
    expect(route).not.toContain("allowTool");
  });

  it("approval never depends on a tool's arguments", async () => {
    const factory = await read("./index.ts");
    const leaf = await read("./gatedTools.ts");
    const gate = await read("./approvalGate.ts");
    for (const flag of ["dryRun", "args.", "input."]) {
      expect(leaf, "gatedTools.ts").not.toContain(flag);
      expect(gate, "approvalGate.ts").not.toContain(flag);
    }
    expect(factory).not.toContain("dryRun");
  });
});

describe("requiresApproval", () => {
  it("gates every built-in write", () => {
    for (const name of GATED_TOOL_NAMES) expect(requiresApproval(name), name).toBe(true);
  });

  it("lets built-in reads, the memory tools and load_tools run", () => {
    for (const name of UNGATED_TOOL_NAMES) expect(requiresApproval(name), name).toBe(false);
  });

  it("gates any other name: MCP tools, and anything unknown", () => {
    for (const name of ["bank_get_balance", "gmail_search_messages", "made_up"]) {
      expect(requiresApproval(name), name).toBe(true);
    }
  });

  it("names load_tools as the disclosure package does", () => {
    expect(LOAD_TOOLS_TOOL_NAME).toBe(LOAD_TOOLS_TOOL);
  });
});

/** Plays scripted replies in order, then answers "done". */
class ScriptedModel extends BaseChatModel {
  constructor(private replies: AIMessage[]) {
    super({});
  }
  _llmType() {
    return "scripted";
  }
  bindTools() {
    return this;
  }
  async _generate(): Promise<ChatResult> {
    const message = this.replies.shift() ?? new AIMessage("done");
    return { generations: [{ message, text: "" }] };
  }
}

const call = (id: string, name: string, args: Record<string, unknown> = {}) =>
  new AIMessage({ content: "", tool_calls: [{ id, name, args, type: "tool_call" }] });

const bank: DisclosureServer = {
  id: "id-bank",
  name: "bank",
  authRequired: false,
  catalog: {
    serverId: "id-bank",
    toolsHash: "hash",
    tools: [{ name: "get_balance", description: "Balance", inputSchema: { type: "object" } }],
    toolCount: 1,
    schemaTokens: 10,
    summary: "bank tools",
    summarySource: "heuristic",
    refreshedAt: new Date(0),
  },
};

/** Tool names that actually ran, built-in or MCP. */
const ran: string[] = [];
const fakeTool = (name: string) =>
  tool(
    async () => {
      ran.push(name);
      return `${name} ok`;
    },
    { name, description: `fake ${name}`, schema: z.object({}) },
  );
const resolveTool: ResolveMcpTool = async (_id, name) => ({ ok: true, tool: fakeTool(name) });

function build(replies: AIMessage[], servers: DisclosureServer[] = [bank]) {
  return createAgent({
    model: new ScriptedModel(replies),
    tools: [fakeTool("list_categories"), fakeTool("log_expense")],
    checkpointer: new MemorySaver(),
    middleware: [
      mcpServerDisclosureMiddleware({ servers, resolveTool, log: () => {} }),
      approvalGateMiddleware(),
    ],
  });
}

const config = (thread: string) => ({ configurable: { thread_id: thread } });

async function pausedOn(agent: ReturnType<typeof build>, thread: string) {
  return readPendingBatch((await agent.graph.getState(config(thread))) as GraphSnapshot);
}

/** The resume the app would send for this batch, every call decided the same way. */
function decide(batch: Awaited<ReturnType<typeof pausedOn>>, decision: "allow" | "deny") {
  const resolved = resolveDecisions({
    ...batch,
    decisions: Object.fromEntries(batch.pausedCalls.map((c) => [c.id, decision])),
  });
  if (!resolved.ok) throw new Error(resolved.error);
  return toResumeCommand(resolved.decisions);
}

const toolAnswer = (out: { messages: BaseMessage[] }, id: string) =>
  out.messages.find((m) => ToolMessage.isInstance(m) && m.tool_call_id === id) as
    | ToolMessage
    | undefined;

beforeEach(() => {
  ran.length = 0;
});

describe("the gate at run time", () => {
  it("pauses an MCP tool loaded mid-thread, and runs it only once approved", async () => {
    const agent = build([
      call("load-1", "load_tools", { query: "balance" }),
      call("mcp-1", "bank_get_balance"),
    ]);
    await agent.invoke({ messages: [new HumanMessage("my balance?")] }, config("t1"));

    // load_tools ran unreviewed; the MCP call it made callable is held.
    const batch = await pausedOn(agent, "t1");
    expect(batch.actionRequests.map((a) => a.name)).toEqual(["bank_get_balance"]);
    expect(batch.pausedCalls.map((c) => c.id)).toEqual(["mcp-1"]);
    expect(ran).toEqual([]);

    await agent.invoke(decide(batch, "allow"), config("t1"));
    expect(ran).toEqual(["bank_get_balance"]);
  });

  it("a denied MCP call never reaches its server", async () => {
    const agent = build([call("mcp-1", "bank_get_balance")]);
    await agent.invoke({ messages: [new HumanMessage("balance")] }, config("t2"));
    const out = await agent.invoke(decide(await pausedOn(agent, "t2"), "deny"), config("t2"));
    expect(ran).toEqual([]);
    expect(toolAnswer(out, "mcp-1")?.status).toBe("error");
  });

  it("built-in reads run without pausing; built-in writes still pause", async () => {
    const agent = build([call("r-1", "list_categories"), call("w-1", "log_expense")]);
    await agent.invoke({ messages: [new HumanMessage("log it")] }, config("t3"));
    expect(ran).toEqual(["list_categories"]);
    expect((await pausedOn(agent, "t3")).pausedCalls.map((c) => c.name)).toEqual(["log_expense"]);
  });

  it("a saved tool whose server is gone is gated, then answered server_unavailable", async () => {
    // The same checkpointer for both builds: the later one sees the thread's saved definition.
    const checkpointer = new MemorySaver();
    const withSaver = (replies: AIMessage[], servers: DisclosureServer[]) =>
      createAgent({
        model: new ScriptedModel(replies),
        tools: [fakeTool("list_categories")],
        checkpointer,
        middleware: [
          mcpServerDisclosureMiddleware({ servers, resolveTool, log: () => {} }),
          approvalGateMiddleware(),
        ],
      });

    const first = withSaver([call("load-1", "load_tools", { query: "get_balance" })], [bank]);
    await first.invoke({ messages: [new HumanMessage("load")] }, config("t4"));

    // The server was removed: no catalog, so nothing names bank_get_balance but the thread.
    const later = withSaver([call("mcp-1", "bank_get_balance")], []);
    await later.invoke({ messages: [new HumanMessage("balance")] }, config("t4"));
    const batch = readPendingBatch((await later.graph.getState(config("t4"))) as GraphSnapshot);
    expect(batch.pausedCalls.map((c) => c.name)).toEqual(["bank_get_balance"]);

    const out = await later.invoke(decide(batch, "allow"), config("t4"));
    expect(ran).toEqual([]);
    expect(JSON.parse(String(toolAnswer(out, "mcp-1")?.content)).error).toBe("server_unavailable");
  });
});
