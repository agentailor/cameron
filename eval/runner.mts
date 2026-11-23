import { HumanMessage, isAIMessage, isToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { randomUUID } from "node:crypto";
import {
  readPendingBatch,
  resolveDecisions,
  toResumeCommand,
  type GraphSnapshot,
  type PendingBatch,
} from "../src/services/approvalDecisions.ts";
import { LIMITS } from "./config.mts";
import { runSimulatedConversation } from "./simulatedUser.mts";
import type {
  ApprovalPolicy,
  ConversationTurn,
  EvalCase,
  Inconclusive,
  RunCapture,
  SimulatedUser,
  ThreadCapture,
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
 * Read the batch the graph is paused on, exactly the way the app does (`readPendingBatch`, shared
 * with src/services/agentService.ts). An empty batch means nothing is pending — which for an
 * approval case is itself the finding: the mutation never hit the gate.
 */
async function pendingBatch(agent: Agent, threadId: string): Promise<PendingBatch> {
  const snapshot = await agent.graph.getState({ configurable: { thread_id: threadId } });
  return readPendingBatch(snapshot as GraphSnapshot);
}

const callsOf = (batch: PendingBatch): ToolCall[] =>
  batch.actionRequests.map((a) => ({ name: a.name, args: a.args as Record<string, unknown> }));

/** Answer one batch through the app's own resolver, so the model sees what the UI would send. */
function resumeFor(
  policy: ApprovalPolicy,
  batch: PendingBatch,
): ReturnType<typeof toResumeCommand> {
  const decide = typeof policy === "string" ? () => policy : policy.decide;
  const decisions = Object.fromEntries(
    batch.pausedCalls.map((c) => [
      c.id,
      decide({ name: c.name, args: c.args as Record<string, unknown> }),
    ]),
  );
  const resolved = resolveDecisions({ ...batch, decisions });
  if (!resolved.ok) throw new Error(`approval resume refused: ${resolved.error}`);
  return toResumeCommand(resolved.decisions);
}

/**
 * Builds the agent for one message. The app rebuilds it per message (tools such as `recall` list
 * what was in the database when the message started), so the eval does too: a memory saved in one
 * thread must be visible to the next exactly as it would be in the app.
 */
export type AgentFactory = () => Promise<Agent>;

export async function runCase(agentFor: AgentFactory, testCase: EvalCase): Promise<RunCapture> {
  const trajectory: ToolCall[] = [];
  const toolResults: ToolResult[] = [];
  const interrupts: ToolCall[] = [];
  const interruptBatches: ToolCall[][] = [];

  let finalText = "";
  let pausedAtEnd = false;

  const multiThread = (testCase.threads?.length ?? 0) > 0;
  const threadCaptures: ThreadCapture[] = [];
  const conversation: ConversationTurn[] = [];

  // Separate from the per-turn budget: a conversation of unknown length would otherwise abort
  // mid-flight and surface as a throw, i.e. as an agent crash.
  const deadline = AbortSignal.timeout(LIMITS.conversationTimeoutMs);

  /** One conversation on its own thread. Returns why it was inconclusive, if it was. */
  async function runThread(
    opening: string,
    user: SimulatedUser | undefined,
    index: number,
  ): Promise<Inconclusive | undefined> {
    const threadId = `${testCase.id}-${index + 1}-${randomUUID()}`;
    const scoped: ThreadCapture = {
      finalText: "",
      trajectory: [],
      toolResults: [],
      interrupts: [],
    };
    threadCaptures.push(scoped);

    // Each invoke returns the WHOLE thread; `seen` is the cursor past what's already collected.
    let seen = 0;

    /** Collect `fresh` into the run's capture and this thread's. */
    function take(fresh: BaseMessage[]): void {
      collect(fresh, trajectory, toolResults);
      collect(fresh, scoped.trajectory, scoped.toolResults);
      const text = lastAssistantText(fresh);
      finalText = text || finalText;
      scoped.finalText = text || scoped.finalText;
    }

    /** One user message in, the agent's reply out, approval interrupts settled. */
    async function send(text: string): Promise<string> {
      const agent = await agentFor();
      const config = {
        configurable: { thread_id: threadId },
        recursionLimit: LIMITS.recursionLimit,
        signal: AbortSignal.any([deadline, AbortSignal.timeout(LIMITS.timeoutMs)]),
      };

      let result = await agent.invoke({ messages: [new HumanMessage(text)] }, config);
      let fresh = result.messages.slice(seen);
      take(fresh);
      seen = result.messages.length;
      let turnText = lastAssistantText(fresh);

      // With `approval` set the middleware is live, so a gated call pauses instead of running.
      if (testCase.approval) {
        let batch = await pendingBatch(agent, threadId);
        const record = () => {
          if (batch.actionRequests.length === 0) return;
          interrupts.push(...callsOf(batch));
          scoped.interrupts.push(...callsOf(batch));
          interruptBatches.push(callsOf(batch));
        };
        record();

        // A turn can pause more than once — keep resuming until nothing is pending.
        // See "Approval cases" in eval/README.md for why answering only the first breaks a case.
        for (
          let guard = 0;
          batch.actionRequests.length > 0 && guard < LIMITS.recursionLimit;
          guard++
        ) {
          result = await agent.invoke(resumeFor(testCase.approval, batch), config);
          fresh = result.messages.slice(seen);
          take(fresh);
          seen = result.messages.length;
          turnText = lastAssistantText(fresh) || turnText;

          batch = await pendingBatch(agent, threadId);
          record();
        }

        // Still pending: the agent is waiting, not finished — a distinction `trajectory` can't make.
        pausedAtEnd = batch.actionRequests.length > 0;
      }

      return turnText;
    }

    const mark = (turns: ConversationTurn[]) =>
      multiThread ? turns.map((t) => ({ ...t, thread: index + 1 })) : turns;

    if (user) {
      const simulated = await runSimulatedConversation({
        user,
        opening,
        hooks: { send },
        threadId,
      });
      conversation.push(...mark(simulated.conversation));
      return simulated.inconclusive;
    }

    const reply = await send(opening);
    // A single-turn first thread is already shown as the case's `prompt`; later threads are not.
    if (multiThread) {
      conversation.push(
        ...mark([
          { role: "user", text: opening, source: "fixed" },
          { role: "assistant", text: reply },
        ]),
      );
    }
    return undefined;
  }

  const base = () => ({
    finalText,
    trajectory,
    toolResults,
    interrupts,
    interruptBatches,
    pausedAtEnd,
    ...(conversation.length ? { conversation } : {}),
    ...(multiThread ? { threads: threadCaptures } : {}),
  });

  try {
    const plan = [{ prompt: testCase.prompt, user: testCase.user }, ...(testCase.threads ?? [])];
    for (const [index, thread] of plan.entries()) {
      const inconclusive = await runThread(thread.prompt, thread.user, index);
      // A later thread tests what survived this one; without its evidence there's nothing to grade.
      if (inconclusive) return { ...base(), inconclusive };
    }
    return base();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Running out of the conversation budget is the harness giving up, not the agent crashing.
    if (deadline.aborted && hasSimulatedUser(testCase)) {
      return {
        ...base(),
        inconclusive: {
          reason: "conversation-timeout",
          detail: `the conversation exceeded ${LIMITS.conversationTimeoutMs / 1000}s`,
        },
      };
    }
    return { ...base(), error: message };
  }
}

/** Whether any thread is a simulated conversation (only those have an open-ended length). */
function hasSimulatedUser(testCase: EvalCase): boolean {
  return Boolean(testCase.user) || (testCase.threads ?? []).some((t) => t.user);
}
