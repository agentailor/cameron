import { describe, expect, it } from "vitest";
import { createAgent } from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import {
  CLEARED_PLACEHOLDER,
  NEVER_CLEARED_TOOLS,
  contextEditingMiddleware,
} from "./contextEditing";
import { listCapabilities } from "./capabilities";

/** Records the messages of every model call. */
class Recorder extends BaseCallbackHandler {
  name = "recorder";
  calls: BaseMessage[][] = [];
  handleChatModelStart(_llm: unknown, messages: BaseMessage[][]) {
    this.calls.push(messages[0]);
  }
}

const BIG = "x".repeat(2_000);

function call(id: string, name: string) {
  return new AIMessage({ content: "", tool_calls: [{ id, name, args: {}, type: "tool_call" }] });
}

function result(id: string, name: string, content = BIG) {
  return new ToolMessage({ tool_call_id: id, name, content });
}

async function run(history: BaseMessage[], keepResults = 0) {
  const recorder = new Recorder();
  const agent = createAgent({
    model: new FakeListChatModel({ responses: ["ok"] }),
    tools: [],
    checkpointer: new MemorySaver(),
    middleware: [contextEditingMiddleware({ triggerTokens: 100, keepResults })],
  });
  const config = { configurable: { thread_id: "t" }, callbacks: [recorder] };
  await agent.invoke({ messages: history }, config);
  const state = (await agent.graph.getState(config)) as { values: { messages: BaseMessage[] } };
  const saved = state.values.messages;
  return { sent: recorder.calls[0], saved };
}

const toolContents = (messages: BaseMessage[]) =>
  messages.filter((m) => ToolMessage.isInstance(m)).map((m) => m.content);

describe("contextEditingMiddleware", () => {
  it("clears old results in the request but never in the saved thread", async () => {
    const { sent, saved } = await run([
      new HumanMessage("total?"),
      call("c1", "run_sql"),
      result("c1", "run_sql"),
      new HumanMessage("and now?"),
    ]);

    expect(toolContents(sent)).toEqual([CLEARED_PLACEHOLDER]);
    expect(toolContents(saved)).toEqual([BIG]);
  });

  it("keeps the most recent results", async () => {
    const { sent } = await run(
      [
        new HumanMessage("q"),
        call("c1", "run_sql"),
        result("c1", "run_sql", `old${BIG}`),
        call("c2", "run_sql"),
        result("c2", "run_sql", `new${BIG}`),
      ],
      1,
    );

    expect(toolContents(sent)).toEqual([CLEARED_PLACEHOLDER, `new${BIG}`]);
  });

  it("never clears the excluded tools", async () => {
    const history: BaseMessage[] = [new HumanMessage("q")];
    for (const name of NEVER_CLEARED_TOOLS) history.push(call(name, name), result(name, name));
    history.push(new HumanMessage("again"));

    const { sent } = await run(history);

    expect(toolContents(sent)).toEqual(NEVER_CLEARED_TOOLS.map(() => BIG));
  });

  it("leaves short threads alone", async () => {
    const { sent } = await run([
      new HumanMessage("q"),
      call("c1", "run_sql"),
      result("c1", "run_sql", "{}"),
      new HumanMessage("again"),
    ]);

    expect(toolContents(sent)).toEqual(["{}"]);
  });

  it("only names tools that are actually registered", () => {
    const real = new Set(listCapabilities().map((c) => c.name));
    expect(NEVER_CLEARED_TOOLS.filter((n) => !real.has(n))).toEqual([]);
  });
});
