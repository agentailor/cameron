import { ensureAgent } from "@/lib/agent";
import { ensureThread } from "@/lib/thread";
import type { ApprovalDecision, MessageOptions, MessageResponse } from "@/types/message";
import * as threadRepo from "@/lib/repositories/threadRepository";
import { getHistory, getPendingInterrupts } from "@/lib/agent/memory";
import { HumanMessage } from "@langchain/core/messages";
import type { Command } from "@langchain/langgraph";
import { readPendingBatch, resolveDecisions, toResumeCommand } from "./approvalDecisions";
import { processAttachmentsForAI } from "@/lib/storage/content";
import { streamMessages, type AgentRun } from "./messageStream";
import { markPendingCalls, projectHistory } from "./historyProjection";
import { GenAiTracer } from "@/lib/tracing/genAiTracer";
import { tracingEnabled } from "@/lib/tracing/config";
import { grantsForThread, syncTaskRun } from "@/lib/tasks/scheduler";

/** Stream a turn (or resume a paused one) as MessageResponse chunks for the SSE route. */
export async function streamResponse(params: {
  threadId: string;
  userText: string;
  opts?: MessageOptions;
}) {
  const { threadId, userText, opts } = params;
  await ensureThread(threadId, userText);

  // No approval-bypass is threaded through from the request. The gate is Cameron's first rule,
  // so it is not something a client can turn off — `bypassApprovalForEval` exists only for the
  // eval harness, which calls the agent factory directly.
  const agent = await ensureAgent({
    model: opts?.model,
    provider: opts?.provider,
    tools: opts?.tools,
    // Only a scheduled task's own thread, while its run is open; derived from the thread, never
    // from the request.
    preApprovedTools: await grantsForThread(threadId),
  });

  const config = {
    version: "v3" as const,
    configurable: { thread_id: threadId },
    ...(tracingEnabled() ? { callbacks: [new GenAiTracer()] } : {}),
  };

  // A pending approval resumes the interrupt; otherwise start a fresh turn from the user message.
  const inputs = opts?.decisions
    ? await buildResumeCommand(agent, threadId, opts.decisions)
    : { messages: [new HumanMessage({ content: await buildMessageContent(userText, opts) })] };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = (await agent.streamEvents(inputs as any, config)) as unknown as AgentRun;
  return withTaskSync(streamMessages(run), agent, threadId);
}

/** Once the turn has streamed, a task run whose thread this is records where it now stands. */
async function* withTaskSync<T>(
  messages: AsyncGenerator<T>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: any,
  threadId: string,
): AsyncGenerator<T> {
  yield* messages;
  try {
    await syncTaskRun(agent, threadId);
  } catch (error) {
    console.error("[tasks] Could not record the run after this turn:", error);
  }
}

/** Combine user text with any processed attachments into a message content payload. */
async function buildMessageContent(
  userText: string,
  opts?: MessageOptions,
): Promise<string | Array<{ type: string; text?: string; image_url?: { url: string } }>> {
  if (opts?.attachments && opts.attachments.length > 0) {
    const attachmentContents = await processAttachmentsForAI(opts.attachments);
    return [{ type: "text", text: userText }, ...attachmentContents];
  }
  return userText;
}

// Translate the client's per-call decisions into a HITL resume Command. The pending batch is read
// from the checkpoint; the id -> position mapping and every refusal live in approvalDecisions.ts.
async function buildResumeCommand(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: any,
  threadId: string,
  decisions: Record<string, ApprovalDecision>,
): Promise<Command> {
  // No fallback: an unreadable checkpoint must not resume with a guessed decision.
  const snapshot = await agent.graph.getState({ configurable: { thread_id: threadId } });
  const resolved = resolveDecisions({ ...readPendingBatch(snapshot), decisions });
  if (!resolved.ok) throw new Error(resolved.error);

  return toResumeCommand(resolved.decisions);
}

/** Fetch prior messages for a thread from the LangGraph checkpoint/memory system. */
export async function fetchThreadHistory(threadId: string): Promise<MessageResponse[]> {
  const thread = await threadRepo.getById(threadId);
  if (!thread) return [];
  try {
    const [history, interrupts] = await Promise.all([
      getHistory(threadId),
      getPendingInterrupts(threadId),
    ]);
    const batch = readPendingBatch({ tasks: [{ interrupts }], values: { messages: history } });
    const pendingIds = batch.actionRequests.length > 0 ? batch.pausedCalls.map((c) => c.id) : [];
    return markPendingCalls(projectHistory(history), pendingIds);
  } catch (e) {
    console.error("fetchThreadHistory error", e);
    return [];
  }
}
