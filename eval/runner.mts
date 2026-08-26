import { HumanMessage, isAIMessage, isToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import type { Decision, HITLRequest, HITLResponse } from "langchain";
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

type Agent = {
  invoke: (input: unknown, config: unknown) => Promise<{ messages: BaseMessage[] }>;
  graph: { getState: (config: unknown) => Promise<unknown> };
};

/** Walk a message list into trajectory + tool results, appending to what's already captured. */
function collect(messages: BaseMessage[], trajectory: ToolCall[], toolResults: ToolResult[]): void {
  for (const m of messages) {
    if (isAIMessage(m)) {
      for (const tc of m.tool_calls ?? []) trajectory.push({ name: tc.name, args: tc.args });
    }
    if (isToolMessage(m)) {
      toolResults.push({ name: m.name ?? "unknown", content: flatten(m.content) });
    }
  }
}

/** Last AI message with non-empty text — the answer the user would actually read. */
function lastAssistantText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!isAIMessage(m)) continue;
    const text = flatten(m.content);
    if (text.trim()) return text;
  }
  return "";
}

/**
 * Read the approval request the graph is paused on, exactly the way the app does
 * (see `buildResumeCommand` in src/services/agentService.ts). Returns [] when nothing is pending —
 * which for an approval case is itself the finding: the mutation never hit the gate.
 */
async function pendingActions(agent: Agent, threadId: string): Promise<ToolCall[]> {
  const snapshot = (await agent.graph.getState({ configurable: { thread_id: threadId } })) as {
    tasks?: { interrupts?: { value: unknown }[] }[];
  };
  const pending = snapshot.tasks
    ?.flatMap((t) => t.interrupts ?? [])
    .map((i) => i.value as HITLRequest | undefined)
    .find((v) => v && Array.isArray(v.actionRequests));
  return (pending?.actionRequests ?? []).map((a) => ({ name: a.name, args: a.args }));
}

export async function runCase(agent: Agent, testCase: EvalCase): Promise<RunCapture> {
  const threadId = `${testCase.id}-${randomUUID()}`;
  const config = {
    configurable: { thread_id: threadId },
    recursionLimit: LIMITS.recursionLimit,
    signal: AbortSignal.timeout(LIMITS.timeoutMs),
  };

  const trajectory: ToolCall[] = [];
  const toolResults: ToolResult[] = [];
  const interrupts: ToolCall[] = [];
  const turns = Array.isArray(testCase.prompt) ? testCase.prompt : [testCase.prompt];

  try {
    let finalText = "";
    // Every turn reuses one thread_id, so the Postgres checkpointer carries the conversation
    // forward — no message history is replayed by hand.
    let seen = 0;

    for (const turn of turns) {
      let result = await agent.invoke({ messages: [new HumanMessage(turn)] }, config);
      // The checkpointer accumulates, so each invoke returns the WHOLE thread. Collecting it
      // wholesale would count earlier tool calls again on every turn.
      let fresh = result.messages.slice(seen);
      collect(fresh, trajectory, toolResults);
      seen = result.messages.length;
      finalText = lastAssistantText(fresh) || finalText;

      // With `approval` set the middleware is live, so a mutating call pauses instead of running.
      // Answer it the way the UI would and let the graph finish before the next turn starts.
      if (testCase.approval) {
        const actions = await pendingActions(agent, threadId);
        interrupts.push(...actions);

        if (actions.length > 0) {
          const decision: Decision =
            testCase.approval === "allow"
              ? { type: "approve" }
              : { type: "reject", message: "The user denied this action." };
          // One decision per action request, positionally aligned — the middleware batches a
          // turn's approval-requiring calls into a single interrupt.
          const resume: HITLResponse = { decisions: actions.map(() => decision) };

          result = await agent.invoke(new Command({ resume }), config);
          fresh = result.messages.slice(seen);
          collect(fresh, trajectory, toolResults);
          seen = result.messages.length;
          finalText = lastAssistantText(fresh) || finalText;
        }
      }
    }

    return { finalText, trajectory, toolResults, interrupts };
  } catch (err) {
    return {
      finalText: "",
      trajectory,
      toolResults,
      interrupts,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
