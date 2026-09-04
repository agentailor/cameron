import { HumanMessage, isAIMessage, isToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import type { Decision, HITLRequest, HITLResponse } from "langchain";
import { randomUUID } from "node:crypto";
import { LIMITS } from "./config.mts";
import { runSimulatedConversation } from "./simulatedUser.mts";
import type {
  ConversationTurn,
  EvalCase,
  Inconclusive,
  RunCapture,
  ToolCall,
  ToolResult,
} from "./types.mts";

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

  const trajectory: ToolCall[] = [];
  const toolResults: ToolResult[] = [];
  const interrupts: ToolCall[] = [];
  const turns = Array.isArray(testCase.prompt) ? testCase.prompt : [testCase.prompt];

  // Each invoke returns the WHOLE thread; `seen` is the cursor past what's already collected.
  let seen = 0;
  let finalText = "";
  let pausedAtEnd = false;

  // Separate from the per-turn budget: a conversation of unknown length would otherwise abort
  // mid-flight and surface as a throw, i.e. as an agent crash.
  const deadline = AbortSignal.timeout(LIMITS.conversationTimeoutMs);

  /** One user message in, the agent's reply out, approval interrupts settled. Shared by both paths. */
  async function send(text: string): Promise<string> {
    const config = {
      configurable: { thread_id: threadId },
      recursionLimit: LIMITS.recursionLimit,
      signal: AbortSignal.any([deadline, AbortSignal.timeout(LIMITS.timeoutMs)]),
    };

    let result = await agent.invoke({ messages: [new HumanMessage(text)] }, config);
    let fresh = result.messages.slice(seen);
    collect(fresh, trajectory, toolResults);
    seen = result.messages.length;
    finalText = lastAssistantText(fresh) || finalText;
    let turnText = lastAssistantText(fresh);

    // With `approval` set the middleware is live, so a mutating call pauses instead of running.
    if (testCase.approval) {
      let batch = await pendingActions(agent, threadId);
      interrupts.push(...batch);

      // A turn can pause more than once — keep resuming until nothing is pending.
      // See "Approval cases" in eval/README.md for why answering only the first breaks a case.
      for (let guard = 0; batch.length > 0 && guard < LIMITS.recursionLimit; guard++) {
        const decision: Decision =
          testCase.approval === "allow"
            ? { type: "approve" }
            : { type: "reject", message: "The user denied this action." };
        // One decision per action request, positionally aligned.
        const resume: HITLResponse = { decisions: batch.map(() => decision) };

        result = await agent.invoke(new Command({ resume }), config);
        fresh = result.messages.slice(seen);
        collect(fresh, trajectory, toolResults);
        seen = result.messages.length;
        finalText = lastAssistantText(fresh) || finalText;
        turnText = lastAssistantText(fresh) || turnText;

        batch = await pendingActions(agent, threadId);
        interrupts.push(...batch);
      }

      // Still pending: the agent is waiting, not finished — a distinction `trajectory` can't make.
      pausedAtEnd = batch.length > 0;
    }

    return turnText;
  }

  try {
    let conversation: ConversationTurn[] | undefined;
    let inconclusive: Inconclusive | undefined;

    if (testCase.user) {
      const simulated = await runSimulatedConversation({
        user: testCase.user,
        opening: turns,
        hooks: { send },
        threadId,
      });
      conversation = simulated.conversation;
      inconclusive = simulated.inconclusive;
    } else {
      for (const turn of turns) await send(turn);
    }

    return {
      finalText,
      trajectory,
      toolResults,
      interrupts,
      pausedAtEnd,
      ...(conversation ? { conversation } : {}),
      ...(inconclusive ? { inconclusive } : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Running out of the conversation budget is the harness giving up, not the agent crashing.
    if (testCase.user && deadline.aborted) {
      return {
        finalText,
        trajectory,
        toolResults,
        interrupts,
        pausedAtEnd,
        inconclusive: {
          reason: "conversation-timeout",
          detail: `the conversation exceeded ${LIMITS.conversationTimeoutMs / 1000}s`,
        },
      };
    }
    return { finalText, trajectory, toolResults, interrupts, pausedAtEnd, error: message };
  }
}
