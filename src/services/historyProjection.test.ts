import { describe, it, expect } from "vitest";
import { __projectMessage } from "./historyProjection";
import type { AIMessageData, BasicMessageData, ToolMessageData } from "@/types/message";

// `toDict()` output as the checkpoint really returns it — provider fields included.
const aiWithToolCall = {
  type: "ai",
  data: {
    id: "ai-1",
    content: [{ type: "tool_call", id: "call-1", name: "log_expense", args: { amount: 12 } }],
    content_blocks: [
      { type: "tool_call", id: "call-1", name: "log_expense", args: { amount: 12 } },
    ],
    tool_calls: [{ type: "tool_call", id: "call-1", name: "log_expense", args: { amount: 12 } }],
    usage_metadata: { input_tokens: 6807, output_tokens: 107, total_tokens: 6914 },
    response_metadata: { finish_reason: "tool_use", output_version: "v1" },
    invalid_tool_calls: [],
    additional_kwargs: {},
    name: "model",
  },
};

describe("projectMessage", () => {
  it("drops LangChain fields no component reads", () => {
    const out = __projectMessage(aiWithToolCall);
    for (const key of [
      "content_blocks",
      "usage_metadata",
      "response_metadata",
      "invalid_tool_calls",
      "additional_kwargs",
      "name",
    ]) {
      expect(out.data).not.toHaveProperty(key);
    }
  });

  it("drops a content array that only restates tool_calls", () => {
    const out = __projectMessage(aiWithToolCall);
    const data = out.data as AIMessageData;
    expect(data.content).toBeUndefined();
    // The call itself must survive — it is what the UI renders.
    expect(data.tool_calls).toEqual(aiWithToolCall.data.tool_calls);
  });

  it("keeps content when it mixes prose with a tool call", () => {
    const out = __projectMessage({
      type: "ai",
      data: {
        id: "ai-2",
        content: [
          { type: "text", text: "Logging that now." },
          { type: "tool_call", id: "call-2", name: "log_expense", args: {} },
        ],
        tool_calls: [{ type: "tool_call", id: "call-2", name: "log_expense", args: {} }],
      },
    });
    const data = out.data as AIMessageData;
    expect(data.content).toHaveLength(2);
  });

  it("keeps plain assistant prose", () => {
    const out = __projectMessage({
      type: "ai",
      data: { id: "ai-3", content: "You spent 42 EUR on dining.", usage_metadata: { a: 1 } },
    });
    expect((out.data as AIMessageData).content).toBe("You spent 42 EUR on dining.");
  });

  it("preserves pendingToolCallIds — the only approval-gate signal", () => {
    const out = __projectMessage({
      type: "ai",
      data: { id: "ai-4", content: "", pendingToolCallIds: ["call-9"] },
    });
    expect((out.data as AIMessageData).pendingToolCallIds).toEqual(["call-9"]);
  });

  it("keeps the fields a tool result is paired and rendered by", () => {
    const out = __projectMessage({
      type: "tool",
      data: {
        id: "tool-1",
        content: '{"ok":true}',
        tool_call_id: "call-1",
        name: "log_expense",
        status: "success",
        metadata: { versions: { "@langchain/core": "1.2.1" } },
        additional_kwargs: {},
      },
    });
    const data = out.data as ToolMessageData;
    expect(data).toEqual({
      id: "tool-1",
      content: '{"ok":true}',
      tool_call_id: "call-1",
      name: "log_expense",
      status: "success",
    });
  });

  it("keeps a chart artifact — the chart renders from it, not from content", () => {
    const artifact = { chartType: "line", rows: [{ month: "2026-01", total: 12 }] };
    const out = __projectMessage({
      type: "tool",
      data: { id: "t", content: "{}", tool_call_id: "c", name: "render_chart", artifact },
    });
    expect((out.data as ToolMessageData).artifact).toEqual(artifact);
  });

  it("passes human content through so checkpoint attachments survive", () => {
    const content = [
      { type: "text", text: "load these" },
      {
        type: "text",
        text: "...",
        file_metadata: { name: "releve.csv", key: "k", url: "u", type: "text/csv", size: 10 },
      },
    ];
    const out = __projectMessage({ type: "human", data: { id: "h-1", content } });
    expect(out.type).toBe("human");
    expect((out.data as BasicMessageData).content).toEqual(content);
  });
});
