import { ToolMessage } from "@langchain/core/messages";
import type { MessageResponse, ToolCall } from "@/types/message";
import { producesArtifact } from "@/lib/agent/artifactTools";

/**
 * Turns a LangGraph run's independent projections into the ordered MessageResponse chunks the SSE
 * route forwards.
 *
 * Its own module, and free of I/O, because two contracts live here that nothing else can observe:
 * a tool result must reach the client when it RESOLVES (not when the run ends), and a tool call
 * that was requested but never executed is the only honest signal that the approval gate paused.
 * `agentService.ts` reaches Postgres at module load, so a test importing it cannot stay free.
 */

// Structural view over the `streamEvents(v3)` AgentRunStream — only the projections we forward.
export interface AgentRun {
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
  /** State snapshots. The only stream carrying tool artifacts — `toolCalls[].output` is content. */
  values: AsyncIterable<unknown>;
  output: Promise<unknown>;
}

// `run.messages` (token-level AI text) and `run.toolCalls` (tool results) are independent async
// iterables, so we pump both into a shared queue and drain it as MessageResponse chunks until the
// run settles.
export function streamMessages(run: AgentRun): AsyncGenerator<MessageResponse, void, unknown> {
  const queue: MessageResponse[] = [];
  let notify: (() => void) | null = null;
  let done = false;
  let failure: unknown = null;

  const push = (msg: MessageResponse) => {
    queue.push(msg);
    notify?.();
  };

  // Every tool call the model asked for, and every one that actually ran. A call that was
  // requested but never executed is one the HITL gate paused — that difference is the ONLY
  // honest signal for "show the approval buttons", and it is not derivable on the client.
  const requestedCalls = new Map<string, { id: string; name: string }>();
  const executedCallIds = new Set<string>();

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
        for (const call of assembled.tool_calls) {
          if (call.id) requestedCalls.set(call.id, { id, name: call.name });
        }
        push({ type: "ai", data: { id, content: "", tool_calls: assembled.tool_calls } });
      }
    }
  };

  // Artifacts (e.g. render_chart's rows) reach the client but never the model, and they are not on
  // the toolCalls stream — only on the ToolMessages in state. Collected by call id so
  // pumpToolCalls can attach them.
  const artifacts = new Map<string, unknown>();
  const collectArtifacts = (snapshot: unknown) => {
    for (const m of (snapshot as { messages?: unknown[] })?.messages ?? []) {
      if (!ToolMessage.isInstance(m)) continue;
      if (m.artifact !== undefined && m.tool_call_id) artifacts.set(m.tool_call_id, m.artifact);
    }
  };
  const pumpValues = async () => {
    for await (const snapshot of run.values) collectArtifacts(snapshot);
  };

  const pumpToolCalls = async () => {
    for await (const call of run.toolCalls) {
      const [output, status] = await Promise.all([call.output, call.status]);
      const content = typeof output === "string" ? output : JSON.stringify(output ?? "");
      // Only wait on tools that actually produce an artifact. `undefined` means BOTH "not yet
      // delivered" and "this tool has none", so waiting whenever it is missing parks the pump on
      // `run.output` — i.e. until the whole run ends — for every ordinary tool, which is what
      // pushed every tool result to the end of the turn.
      let artifact = artifacts.get(call.callId);
      if (artifact === undefined && producesArtifact(call.name)) {
        collectArtifacts(await run.output);
        artifact = artifacts.get(call.callId);
      }
      if (call.callId) executedCallIds.add(call.callId);
      push({
        type: "tool",
        data: {
          id: call.callId || `tool-${Date.now()}`,
          content,
          status,
          tool_call_id: call.callId,
          name: call.name,
          ...(artifact !== undefined ? { artifact } : {}),
        },
      });
    }
  };

  // A requested call that never executed was paused by the approval gate. Re-emit its AI message
  // marked with the pending ids so the client gates on the graph's real state rather than on the
  // message's position in the list.
  const pushPendingApprovals = () => {
    const pendingByMessage = new Map<string, string[]>();
    for (const [callId, { id }] of requestedCalls) {
      if (executedCallIds.has(callId)) continue;
      pendingByMessage.set(id, [...(pendingByMessage.get(id) ?? []), callId]);
    }
    for (const [id, pendingToolCallIds] of pendingByMessage) {
      push({ type: "ai", data: { id, content: "", pendingToolCallIds } });
    }
  };

  const runPromise = Promise.all([pumpMessages(), pumpValues(), pumpToolCalls(), run.output])
    .then(pushPendingApprovals)
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
