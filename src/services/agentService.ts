import { ensureAgent } from "@/lib/agent";
import { ensureThread } from "@/lib/thread";
import type { ApprovalDecision, MessageOptions, MessageResponse } from "@/types/message";
import * as threadRepo from "@/lib/repositories/threadRepository";
import { getHistory } from "@/lib/agent/memory";
import { HumanMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import type { HITLResponse } from "langchain";
import { readPendingBatch, resolveDecisions } from "./approvalDecisions";
import { processAttachmentsForAI } from "@/lib/storage/content";
import { streamMessages, type AgentRun } from "./messageStream";
import { projectHistory } from "./historyProjection";
import { CallbackHandler } from "@langfuse/langchain";

// Only instantiate when tracing is enabled; avoids errors when Langfuse credentials are absent.
const langfuseHandler = process.env.LANGFUSE_ENABLED === "true" ? new CallbackHandler() : null;

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
  });

  const config = {
    version: "v3" as const,
    configurable: { thread_id: threadId },
    ...(langfuseHandler ? { callbacks: [langfuseHandler] } : {}),
  };

  // A pending approval resumes the interrupt; otherwise start a fresh turn from the user message.
  const inputs = opts?.decisions
    ? await buildResumeCommand(agent, threadId, opts.decisions)
    : { messages: [new HumanMessage({ content: await buildMessageContent(userText, opts) })] };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = (await agent.streamEvents(inputs as any, config)) as unknown as AgentRun;
  return streamMessages(run);
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

  const resume: HITLResponse = { decisions: resolved.decisions };
  return new Command({ resume });
}

/** Fetch prior messages for a thread from the LangGraph checkpoint/memory system. */
export async function fetchThreadHistory(threadId: string): Promise<MessageResponse[]> {
  const thread = await threadRepo.getById(threadId);
  if (!thread) return [];
  try {
    const history = await getHistory(threadId);
    return projectHistory(history);
  } catch (e) {
    console.error("fetchThreadHistory error", e);
    return [];
  }
}
