import { createMiddleware } from "langchain";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { isGraphBubbleUp } from "@langchain/langgraph";

/** Longest error message passed to the model; tool errors can carry whole HTTP bodies. */
export const MAX_TOOL_ERROR_CHARS = 500;

const TRUNCATED = "… [truncated]";

/** The innermost error: each wrapToolCall middleware re-wraps a throw, keeping it on `cause`. */
function rootCause(error: unknown): unknown {
  let current = error;
  for (let depth = 0; depth < 10; depth++) {
    const cause = (current as { cause?: unknown })?.cause;
    if (cause === undefined || cause === current) break;
    current = cause;
  }
  return current;
}

export function capErrorMessage(message: string, max = MAX_TOOL_ERROR_CHARS): string {
  const text = message.trim();
  return text.length <= max ? text : text.slice(0, max - TRUNCATED.length) + TRUNCATED;
}

function errorText(error: unknown): string {
  const root = rootCause(error);
  const text = root instanceof Error ? root.message || root.name : String(root);
  return capErrorMessage(text || "unknown error");
}

/** Payload for a call that threw. */
export function toolFailedPayload(name: string, error: unknown) {
  return {
    ok: false,
    error: "tool_failed",
    message: `${name} failed: ${errorText(error)}`,
  };
}

/** Payload for a call whose run stopped before it returned. */
export const NOT_FINISHED_PAYLOAD = {
  ok: false,
  error: "not_finished",
  message:
    "This call never returned a result: the run stopped before it finished, so it may or may " +
    "not have taken effect. Check before repeating it.",
};

/**
 * Answers every tool call left without a result, in the request only: each provider requires one,
 * and a run that died mid-call left none. The thread itself is never changed.
 */
export function answerDanglingCalls(messages: BaseMessage[]): BaseMessage[] {
  const answered = new Set(
    messages.filter((m) => ToolMessage.isInstance(m)).map((m) => (m as ToolMessage).tool_call_id),
  );
  const out: BaseMessage[] = [];
  let missing: { id: string; name: string }[] = [];
  const flush = () => {
    for (const call of missing) {
      out.push(
        new ToolMessage({
          tool_call_id: call.id,
          name: call.name,
          status: "error",
          content: JSON.stringify(NOT_FINISHED_PAYLOAD),
        }),
      );
    }
    missing = [];
  };
  for (const message of messages) {
    // Stand-ins go after the call's own results, before whatever came next.
    if (!ToolMessage.isInstance(message)) flush();
    out.push(message);
    if (AIMessage.isInstance(message)) {
      missing = (message.tool_calls ?? [])
        .filter((c) => c.id && !answered.has(c.id))
        .map((c) => ({ id: c.id as string, name: c.name }));
    }
  }
  flush();
  return out;
}

/**
 * Turns a throwing tool into an error result the model can answer. With any `wrapToolCall`
 * middleware installed, langchain rethrows a tool's error instead, which ends the run and leaves
 * the call without a result. Installed outermost so it catches every tool, MCP and built-in.
 */
export function toolFailureMiddleware(opts: { log?: (line: string) => void } = {}) {
  const log = opts.log ?? ((line: string) => console.error(line));
  return createMiddleware({
    name: "ToolFailures",
    wrapModelCall: (request, handler) => {
      if (!request.messages?.length) return handler(request);
      const messages = answerDanglingCalls(request.messages);
      return messages.length === request.messages.length
        ? handler(request)
        : handler({ ...request, messages });
    },
    wrapToolCall: async (request, handler) => {
      try {
        return await handler(request);
      } catch (error) {
        // Interrupts are the approval gate; an abort is the owner or a timeout stopping the run.
        if (isGraphBubbleUp(error) || isGraphBubbleUp(rootCause(error))) throw error;
        if (request.runtime?.signal?.aborted) throw error;
        const { name, id } = request.toolCall;
        const root = rootCause(error);
        // The full error stays in the server log; the model gets the capped message.
        log(`[tools] ${name} threw: ${root instanceof Error ? root.stack : String(root)}`);
        return new ToolMessage({
          tool_call_id: id ?? "",
          name,
          status: "error",
          content: JSON.stringify(toolFailedPayload(name, error)),
        });
      }
    },
  });
}
