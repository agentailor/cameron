import { ensureAgent } from "@/lib/agent";
import { ensureThread } from "@/lib/thread";
import type { ApprovalDecision, MessageOptions, MessageResponse } from "@/types/message";
import * as threadRepo from "@/lib/repositories/threadRepository";
import { getHistory, getPendingInterrupts } from "@/lib/agent/memory";
import { HumanMessage } from "@langchain/core/messages";
import type { Command } from "@langchain/langgraph";
import { readPendingBatch, resolveDecisions, toResumeCommand } from "./approvalDecisions";
import {
  readPendingElicitations,
  resolveElicitationAnswers,
  toElicitationResume,
  type RawInterrupt,
} from "./elicitationAnswers";
import type { ElicitationAction, ElicitationAnswers } from "@/lib/mcp/elicitation";
import { ELICITATION_OUTCOMES_KEY } from "@/lib/agent/elicitationNotes";
import { processAttachmentsForAI } from "@/lib/storage/content";
import { streamMessages, type AgentRun } from "./messageStream";
import { markPendingCalls, projectHistory } from "./historyProjection";
import { GenAiTracer } from "@/lib/tracing/genAiTracer";
import { tracingEnabled } from "@/lib/tracing/config";
import { grantsForThread, syncTaskRun } from "@/lib/tasks/scheduler";
import { describeRunError, runErrorMessage, type RunError } from "@/lib/agent/runErrors";
import { readModelSettings } from "@/lib/agent/modelSettings";
import { getProviderDef } from "@/lib/config/modelSettings";

/** Stream a turn (or resume a paused one) as MessageResponse chunks for the SSE route. */
export async function streamResponse(params: {
  threadId: string;
  userText: string;
  opts?: MessageOptions;
}) {
  const { threadId, userText, opts } = params;
  await ensureThread(threadId, userText);
  // A new turn supersedes the last failure.
  await threadRepo.clearRunError(threadId);

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

  // A pending approval or server question resumes its interrupt; otherwise start a fresh turn.
  let inputs: unknown;
  let outcomes: Record<string, ElicitationAction> = {};
  if (opts?.answers) {
    const resumed = await buildElicitationResume(agent, threadId, opts.answers);
    inputs = resumed.command;
    outcomes = resumed.outcomes;
  } else if (opts?.decisions) {
    inputs = await buildResumeCommand(agent, threadId, opts.decisions);
  } else {
    inputs = {
      messages: [new HumanMessage({ content: await buildMessageContent(userText, opts) })],
    };
  }

  const config = {
    version: "v3" as const,
    // The owner's answers per call, read by elicitationNoteMiddleware when the result comes back.
    configurable: { thread_id: threadId, [ELICITATION_OUTCOMES_KEY]: outcomes },
    ...(tracingEnabled() ? { callbacks: [new GenAiTracer()] } : {}),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = (await agent.streamEvents(inputs as any, config)) as unknown as AgentRun;
  const readElicitations = () => pendingElicitationsOf(agent, threadId);
  return withTaskSync(streamMessages(run, { readElicitations }), agent, threadId);
}

/** The server questions a thread is paused on, from the graph's own state. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pendingElicitationsOf(agent: any, threadId: string) {
  const snapshot = await agent.graph.getState({ configurable: { thread_id: threadId } });
  const interrupts: RawInterrupt[] = (snapshot.tasks ?? []).flatMap(
    (t: { interrupts?: RawInterrupt[] }) => t.interrupts ?? [],
  );
  return readPendingElicitations(interrupts, snapshot.values?.messages ?? []);
}

// Same shape as buildResumeCommand: read what is pending, refuse anything that does not match it.
async function buildElicitationResume(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: any,
  threadId: string,
  answers: ElicitationAnswers,
) {
  const pending = await pendingElicitationsOf(agent, threadId);
  const resolved = resolveElicitationAnswers({ pending, answers });
  if (!resolved.ok) throw new Error(resolved.error);
  return { command: toElicitationResume(resolved.resume), outcomes: resolved.outcomes };
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

/**
 * Saves why a run failed on its thread, so a reload still explains the unanswered message, and
 * returns the owner-facing description the stream sends live.
 */
export async function recordRunError(threadId: string, error: unknown): Promise<RunError> {
  console.error(`[agent] run failed on thread ${threadId}:`, error);
  let keyEnvVar: string | undefined;
  try {
    const settings = await readModelSettings();
    if (settings) keyEnvVar = getProviderDef(settings.provider).apiKeyEnvVar;
  } catch {
    // The settings read can fail for the same reason the run did; the message still helps.
  }
  const described = describeRunError(error, { keyEnvVar });
  try {
    await threadRepo.setRunError(threadId, described);
  } catch (e) {
    console.error("[agent] could not save the run error:", e);
  }
  return described;
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
    const asked = readPendingElicitations(interrupts as RawInterrupt[], history);
    const messages = markPendingCalls(projectHistory(history), pendingIds);
    if (asked.length > 0) {
      messages.push({
        type: "ai",
        data: { id: `elicit-${asked[0].interruptId}`, content: "", pendingElicitations: asked },
      });
    }
    // Cleared when the next run starts, so a saved failure is always about the end of the thread.
    const runError = await threadRepo.getRunError(threadId);
    return runError ? [...messages, runErrorMessage(runError)] : messages;
  } catch (e) {
    console.error("fetchThreadHistory error", e);
    return [];
  }
}
