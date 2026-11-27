import { describe, expect, it } from "vitest";
import { tool } from "@langchain/core/tools";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { GraphInterrupt, MemorySaver } from "@langchain/langgraph";
import { createAgent, createMiddleware } from "langchain";
import { z } from "zod";
import {
  answerDanglingCalls,
  capErrorMessage,
  MAX_TOOL_ERROR_CHARS,
  NOT_FINISHED_PAYLOAD,
  toolFailureMiddleware,
} from "./toolFailures";

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

const callSearch = () =>
  new AIMessage({
    content: "",
    tool_calls: [{ id: "call-1", name: "gmail_search_threads", args: { query: "invoice" } }],
  });

/** Stands in for the disclosure middleware: any wrapToolCall makes langchain rethrow tool errors. */
const passThrough = createMiddleware({
  name: "PassThrough",
  wrapToolCall: (request, handler) => handler(request),
});

async function runWith(error: unknown, withFix = true) {
  const middleware = withFix
    ? [toolFailureMiddleware({ log: () => {} }), passThrough]
    : [passThrough];
  const search = tool(
    async () => {
      throw error;
    },
    {
      name: "gmail_search_threads",
      description: "Search",
      schema: z.object({ query: z.string() }),
    },
  );
  const model = new ScriptedModel([callSearch(), new AIMessage("Gmail needs you to sign in.")]);
  const agent = createAgent({
    model,
    tools: [search],
    checkpointer: new MemorySaver(),
    middleware,
  });
  const config = { configurable: { thread_id: "t1" } };
  const state = await agent.invoke({ messages: [new HumanMessage("find invoices")] }, config);
  return { state, model };
}

const resultOf = (messages: BaseMessage[]) => {
  const message = messages.find((m) => ToolMessage.isInstance(m)) as ToolMessage;
  return { status: message.status, ...JSON.parse(String(message.content)) };
};

describe("toolFailureMiddleware", () => {
  it("documents the defect: without it, a throwing tool ends the run", async () => {
    await expect(runWith(new Error("401 Unauthorized"), false)).rejects.toThrow("401 Unauthorized");
  });

  it("returns the error to the model, which then answers", async () => {
    const { state, model } = await runWith(new Error("SdkHttpError: 401 Unauthorized"));

    expect(resultOf(state.messages)).toEqual({
      status: "error",
      ok: false,
      error: "tool_failed",
      message: "gmail_search_threads failed: SdkHttpError: 401 Unauthorized",
    });
    // The model was called again with the result, and its answer ended the run.
    expect(model.seen).toHaveLength(2);
    expect(state.messages.at(-1)?.content).toBe("Gmail needs you to sign in.");
  });

  it("caps a long error message", async () => {
    const { state } = await runWith(new Error(`Error POSTing: ${"x".repeat(5000)}`));
    const { message } = resultOf(state.messages);
    expect(message.length).toBeLessThanOrEqual(MAX_TOOL_ERROR_CHARS + 40);
    expect(message.endsWith("… [truncated]")).toBe(true);
  });

  it("handles a thrown non-Error", async () => {
    const { state } = await runWith("connection reset");
    expect(resultOf(state.messages).message).toBe("gmail_search_threads failed: connection reset");
  });

  it("rethrows interrupts, which are the approval gate", async () => {
    const wrap = toolFailureMiddleware().wrapToolCall as unknown as (
      request: unknown,
      handler: () => Promise<never>,
    ) => Promise<unknown>;
    const interrupt = new GraphInterrupt([]);
    await expect(
      wrap({ toolCall: { id: "c", name: "x", args: {} }, runtime: {} }, async () => {
        throw interrupt;
      }),
    ).rejects.toBe(interrupt);
  });

  it("rethrows once the run is aborted", async () => {
    const wrap = toolFailureMiddleware().wrapToolCall as unknown as (
      request: unknown,
      handler: () => Promise<never>,
    ) => Promise<unknown>;
    const controller = new AbortController();
    controller.abort();
    const error = new Error("aborted");
    await expect(
      wrap(
        { toolCall: { id: "c", name: "x", args: {} }, runtime: { signal: controller.signal } },
        async () => {
          throw error;
        },
      ),
    ).rejects.toBe(error);
  });
});

describe("capErrorMessage", () => {
  it("keeps a short message and trims a long one to the limit", () => {
    expect(capErrorMessage("  boom  ")).toBe("boom");
    const capped = capErrorMessage("y".repeat(MAX_TOOL_ERROR_CHARS * 3));
    expect(capped).toHaveLength(MAX_TOOL_ERROR_CHARS);
    expect(capped.endsWith("… [truncated]")).toBe(true);
  });
});

describe("answerDanglingCalls", () => {
  it("answers a call left without a result, right after its step", () => {
    const messages = [new HumanMessage("find invoices"), callSearch(), new HumanMessage("hello?")];
    const out = answerDanglingCalls(messages);

    expect(out).toHaveLength(4);
    expect(ToolMessage.isInstance(out[2])).toBe(true);
    expect(out[2]).toMatchObject({ tool_call_id: "call-1", status: "error" });
    expect(JSON.parse(String(out[2].content))).toEqual(NOT_FINISHED_PAYLOAD);
    expect(out[3]).toBe(messages[2]);
    // The thread's own array is untouched.
    expect(messages).toHaveLength(3);
  });

  it("only fills the missing ones, after the results that exist", () => {
    const step = new AIMessage({
      content: "",
      tool_calls: [
        { id: "a", name: "run_sql", args: {} },
        { id: "b", name: "list_categories", args: {} },
      ],
    });
    const answered = new ToolMessage({ tool_call_id: "a", name: "run_sql", content: "[]" });
    const out = answerDanglingCalls([step, answered]);

    expect(out.map((m) => (ToolMessage.isInstance(m) ? m.tool_call_id : "ai"))).toEqual([
      "ai",
      "a",
      "b",
    ]);
  });

  it("leaves a complete thread as it is", () => {
    const messages = [
      callSearch(),
      new ToolMessage({ tool_call_id: "call-1", name: "gmail_search_threads", content: "[]" }),
      new AIMessage("nothing found"),
    ];
    expect(answerDanglingCalls(messages)).toEqual(messages);
  });
});
