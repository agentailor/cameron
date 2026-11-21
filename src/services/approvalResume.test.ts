import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { tool } from "@langchain/core/tools";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { MemorySaver } from "@langchain/langgraph";
import { createAgent, humanInTheLoopMiddleware } from "langchain";
import { z } from "zod";
import {
  DENIED_MESSAGE,
  readPendingBatch,
  resolveDecisions,
  toResumeCommand,
  type GraphSnapshot,
} from "./approvalDecisions";

/**
 * A resume must continue the paused step, not restart the run. When it restarted, the next model
 * call carried the gated call with no tool result, which strict OpenAI-compatible endpoints
 * reject with a 400 (lenient ones answered anyway, hiding it).
 */

/** Replays scripted replies and records every message list it was sent. */
class ScriptedModel extends BaseChatModel {
  seen: BaseMessage[][] = [];
  constructor(private replies: AIMessage[]) {
    super({});
  }
  _llmType() {
    return "scripted";
  }
  bindTools() {
    return this;
  }
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.seen.push(messages);
    const message = this.replies.shift() ?? new AIMessage("done");
    return { generations: [{ message, text: "" }] };
  }
}

/** Every tool call an AI message makes is answered before the model is called again. */
function unansweredCalls(messages: BaseMessage[]): string[] {
  const answered = new Set(
    messages.filter((m) => ToolMessage.isInstance(m)).map((m) => (m as ToolMessage).tool_call_id),
  );
  return messages
    .filter((m) => AIMessage.isInstance(m))
    .flatMap((m) => (m as AIMessage).tool_calls ?? [])
    .map((c) => c.id ?? "")
    .filter((id) => !answered.has(id));
}

async function pausedAgent() {
  const writes: unknown[] = [];
  const logExpense = tool(
    async (args) => {
      writes.push(args);
      return "logged";
    },
    { name: "log_expense", description: "Log", schema: z.object({ amount: z.number() }) },
  );
  const listCategories = tool(async () => "[]", {
    name: "list_categories",
    description: "List",
    schema: z.object({}),
  });
  const model = new ScriptedModel([
    new AIMessage({
      content: "",
      tool_calls: [{ id: "read-1", name: "list_categories", args: {} }],
    }),
    new AIMessage({
      content: "",
      tool_calls: [{ id: "write-1", name: "log_expense", args: { amount: 12.5 } }],
    }),
  ]);
  const agent = createAgent({
    model,
    tools: [logExpense, listCategories],
    checkpointer: new MemorySaver(),
    middleware: [humanInTheLoopMiddleware({ interruptOn: { log_expense: true } })],
  });
  const config = { configurable: { thread_id: "t" } };
  await agent.invoke({ messages: [new HumanMessage("log a coffee")] }, config);

  const batch = readPendingBatch((await agent.graph.getState(config)) as GraphSnapshot);
  expect(batch.pausedCalls.map((c) => c.id)).toEqual(["write-1"]);

  async function resume(decision: "allow" | "deny") {
    const resolved = resolveDecisions({ ...batch, decisions: { "write-1": decision } });
    if (!resolved.ok) throw new Error(resolved.error);
    return agent.invoke(toResumeCommand(resolved.decisions), config);
  }
  return { model, writes, resume };
}

describe("resuming the approval gate", () => {
  it("an approval runs the gated call before the model is called again", async () => {
    const { model, writes, resume } = await pausedAgent();
    await resume("allow");

    expect(writes).toEqual([{ amount: 12.5 }]);
    expect(model.seen).toHaveLength(3);
    for (const sent of model.seen) expect(unansweredCalls(sent)).toEqual([]);
  });

  it("a denial answers the gated call with the denial, and writes nothing", async () => {
    const { model, writes, resume } = await pausedAgent();
    await resume("deny");

    expect(writes).toEqual([]);
    const last = model.seen.at(-1)!;
    expect(unansweredCalls(last)).toEqual([]);
    const answer = last.find((m) => ToolMessage.isInstance(m) && m.tool_call_id === "write-1");
    expect(answer?.content).toBe(DENIED_MESSAGE);
  });

  it("no resume path builds its own Command", async () => {
    // Under tsx, eval/*.mts and src/*.ts load langgraph in different module formats, so a
    // Command built outside approvalDecisions.ts fails createAgent's instanceof check.
    for (const path of ["./agentService.ts", "../../eval/runner.mts"]) {
      const source = await readFile(new URL(path, import.meta.url), "utf-8");
      expect(source, path).toContain("toResumeCommand(");
      expect(source, path).not.toMatch(/new Command\(/);
    }
  });
});
