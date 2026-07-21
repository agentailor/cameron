import { ensureAgent } from "@/lib/agent";
import { ensureThread } from "@/lib/thread";
import type { MessageOptions, MessageResponse, ToolCall } from "@/types/message";
import * as threadRepo from "@/lib/repositories/threadRepository";
import { getHistory } from "@/lib/agent/memory";
import { BaseMessage, HumanMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import type { HITLRequest, HITLResponse, Decision } from "langchain";
import { processAttachmentsForAI } from "@/lib/storage/content";
import { CallbackHandler } from "@langfuse/langchain";

// Only instantiate when tracing is enabled; avoids errors when Langfuse credentials are absent.
const langfuseHandler = process.env.LANGFUSE_ENABLED === "true" ? new CallbackHandler() : null;

// Structural view over the `streamEvents(v3)` AgentRunStream — only the projections we forward.
interface AgentRun {
  messages: AsyncIterable<{
    text: AsyncIterable<string>;
    output: PromiseLike<{ id?: string; tool_calls?: ToolCall[] }>;
  }>;
  toolCalls: AsyncIterable<{
    name: string;
    callId: string;
    output: Promise<unknown>;
    status: Promise<string>;
  }>;
  output: Promise<unknown>;
}

/** Stream a turn (or resume a paused one) as MessageResponse chunks for the SSE route. */
export async function streamResponse(params: {
  threadId: string;
  userText: string;
  opts?: MessageOptions;
}) {
  const { threadId, userText, opts } = params;
  await ensureThread(threadId, userText);

  const agent = await ensureAgent({
    model: opts?.model,
    provider: opts?.provider,
    tools: opts?.tools,
    approveAllTools: opts?.approveAllTools,
  });

  const config = {
    version: "v3" as const,
    configurable: { thread_id: threadId },
    ...(langfuseHandler ? { callbacks: [langfuseHandler] } : {}),
  };

  // A pending approval resumes the interrupt; otherwise start a fresh turn from the user message.
  const inputs = opts?.allowTool
    ? await buildResumeCommand(agent, threadId, opts.allowTool)
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

// Translate the client's allow/deny into a HITL resume Command. The middleware batches a turn's
// approval-requiring calls into one interrupt and expects one Decision per action, positionally
// aligned — so we read the pending request from the checkpoint to size the decisions array.
async function buildResumeCommand(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: any,
  threadId: string,
  allowTool: "allow" | "deny",
): Promise<Command> {
  const decision: Decision =
    allowTool === "allow"
      ? { type: "approve" }
      : { type: "reject", message: "The user denied this action." };

  let actionCount = 1;
  try {
    const snapshot = await agent.graph.getState({ configurable: { thread_id: threadId } });
    const pending = snapshot.tasks
      ?.flatMap((t: { interrupts?: { value: unknown }[] }) => t.interrupts ?? [])
      .map((i: { value: unknown }) => i.value as HITLRequest | undefined)
      .find((v: HITLRequest | undefined) => v && Array.isArray(v.actionRequests));
    if (pending && pending.actionRequests.length > 0) {
      actionCount = pending.actionRequests.length;
    }
  } catch (e) {
    // If state can't be read, fall back to a single decision so the thread can still advance.
    console.error("Failed to read pending HITL request:", e);
  }

  const resume: HITLResponse = { decisions: Array.from({ length: actionCount }, () => decision) };
  return new Command({ resume });
}

// `run.messages` (token-level AI text) and `run.toolCalls` (tool results) are independent async
// iterables, so we pump both into a shared queue and drain it as MessageResponse chunks until the
// run settles.
function streamMessages(run: AgentRun): AsyncGenerator<MessageResponse, void, unknown> {
  const queue: MessageResponse[] = [];
  let notify: (() => void) | null = null;
  let done = false;
  let failure: unknown = null;

  const push = (msg: MessageResponse) => {
    queue.push(msg);
    notify?.();
  };

  const pumpMessages = async () => {
    let counter = 0;
    for await (const msg of run.messages) {
      // Tokens stream before `.output` resolves; a synthetic id (reused per message) is enough for
      // the frontend to accumulate text by id.
      const id = `ai-${Date.now()}-${counter++}`;
      for await (const token of msg.text) {
        if (token) push({ type: "ai", data: { id, content: token } });
      }
      // Surface tool calls after the text so the approval UI can render Allow/Deny.
      const assembled = await msg.output;
      if (assembled?.tool_calls && assembled.tool_calls.length > 0) {
        push({ type: "ai", data: { id, content: "", tool_calls: assembled.tool_calls } });
      }
    }
  };

  const pumpToolCalls = async () => {
    for await (const call of run.toolCalls) {
      const [output, status] = await Promise.all([call.output, call.status]);
      const content = typeof output === "string" ? output : JSON.stringify(output ?? "");
      push({
        type: "tool",
        data: {
          id: call.callId || `tool-${Date.now()}`,
          content,
          status,
          tool_call_id: call.callId,
          name: call.name,
        },
      });
    }
  };

  const runPromise = Promise.all([pumpMessages(), pumpToolCalls(), run.output])
    .catch((e) => {
      failure = e;
    })
    .finally(() => {
      done = true;
      notify?.();
    });

  async function* generator(): AsyncGenerator<MessageResponse, void, unknown> {
    while (true) {
      while (queue.length > 0) {
        yield queue.shift()!;
      }
      if (done) break;
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
      notify = null;
    }
    while (queue.length > 0) yield queue.shift()!;
    await runPromise;
    if (failure) throw failure;
  }

  return generator();
}

/** Fetch prior messages for a thread from the LangGraph checkpoint/memory system. */
export async function fetchThreadHistory(threadId: string): Promise<MessageResponse[]> {
  const thread = await threadRepo.getById(threadId);
  if (!thread) return [];
  try {
    const history = await getHistory(threadId);
    return history.map((msg: BaseMessage) => msg.toDict() as MessageResponse);
  } catch (e) {
    console.error("fetchThreadHistory error", e);
    return [];
  }
}
