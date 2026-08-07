import { HumanMessage, isAIMessage, isToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { randomUUID } from "node:crypto";
import { LIMITS } from "./config.mts";
import type { EvalCase, RunCapture, ToolCall, ToolResult } from "./types.mts";

/**
 * Runs a case against the real agent and captures what it did.
 *
 * Capture is not magic: `agent.invoke()` returns the whole message list for the run, so the
 * trajectory is just the tool calls and tool results read back out of it.
 */

function flatten(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: string; text: string } => (b as { type?: string })?.type === "text")
      .map((b) => b.text)
      .join("");
  }
  return "";
}

type Agent = { invoke: (input: unknown, config: unknown) => Promise<{ messages: BaseMessage[] }> };

export async function runCase(agent: Agent, testCase: EvalCase): Promise<RunCapture> {
  const threadId = `${testCase.id}-${randomUUID()}`;

  try {
    const result = await agent.invoke(
      { messages: [new HumanMessage(testCase.prompt)] },
      {
        configurable: { thread_id: threadId },
        recursionLimit: LIMITS.recursionLimit,
        signal: AbortSignal.timeout(LIMITS.timeoutMs),
      },
    );
    const messages = result.messages;

    const trajectory: ToolCall[] = [];
    const toolResults: ToolResult[] = [];
    for (const m of messages) {
      if (isAIMessage(m)) {
        for (const tc of m.tool_calls ?? []) trajectory.push({ name: tc.name, args: tc.args });
      }
      if (isToolMessage(m)) {
        toolResults.push({ name: m.name ?? "unknown", content: flatten(m.content) });
      }
    }

    let finalText = "";
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!isAIMessage(m)) continue;
      const text = flatten(m.content);
      if (text.trim()) {
        finalText = text;
        break;
      }
    }

    return { finalText, trajectory, toolResults };
  } catch (err) {
    return {
      finalText: "",
      trajectory: [],
      toolResults: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
