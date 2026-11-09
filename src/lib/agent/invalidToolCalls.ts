import { createMiddleware } from "langchain";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { findInvalidCalls, invalidCallNotice, type InvalidCall } from "./invalidCallNotice";

/** Extra model calls allowed per step to repair malformed tool-call arguments. */
export const MAX_INVALID_CALL_RETRIES = 2;

/**
 * The model's malformed step and the answer to each of its calls, sent back on the retry only.
 * Every call is answered — the invalid ones with the parse error, the valid ones as not run —
 * because the step is retried whole, and each provider requires an answer for every call.
 */
function correction(
  response: AIMessage,
  invalid: InvalidCall[],
  offered: Set<string>,
): BaseMessage[] {
  const calls = [
    ...(response.tool_calls ?? []).map((c) => ({ ...c, valid: true })),
    ...invalid.map((c, i) => ({
      id: c.id || `invalid-${i}`,
      name: c.name || "unknown_tool",
      args: {},
      valid: false,
      error: c.error,
    })),
  ];
  // Text only: the response's own content can carry the malformed call as a block, and the
  // provider would then see it twice.
  const text =
    typeof response.content === "string"
      ? response.content
      : response.content
          .filter((b) => b.type === "text")
          .map((b) => (b as { text?: string }).text ?? "")
          .join("");
  return [
    new AIMessage({
      content: text,
      tool_calls: calls.map(({ id, name, args }) => ({ id, name, args, type: "tool_call" })),
    }),
    ...calls.map(
      (c) =>
        new ToolMessage({
          tool_call_id: c.id ?? "",
          name: c.name,
          status: "error",
          content: JSON.stringify(
            c.valid
              ? {
                  ok: false,
                  error: "not_run",
                  message: "Not run: another call in this step was malformed. Request it again.",
                }
              : offered.has(c.name)
                ? {
                    ok: false,
                    error: "invalid_arguments",
                    message:
                      `Your arguments for ${c.name} were not valid JSON` +
                      `${"error" in c && c.error ? ` (${c.error})` : ""}. ` +
                      `Call it again with a JSON object matching its schema.`,
                  }
                : // Usually a tool remembered from earlier in the thread, no longer offered.
                  {
                    ok: false,
                    error: "unknown_tool",
                    message:
                      `${c.name} is not one of your tools right now, so it can't be called. ` +
                      `Don't call it again; if the user needs it, tell them it isn't available.`,
                  },
          ),
        }),
    ),
  ];
}

function withNotice(response: AIMessage, notice: string): AIMessage {
  const content =
    typeof response.content === "string"
      ? `${response.content}${response.content ? "\n\n" : ""}${notice}`
      : [...response.content, { type: "text" as const, text: notice }];
  return new AIMessage({ ...response, content });
}

/**
 * A tool call whose arguments don't parse lands in `invalid_tool_calls`, which the agent never
 * runs; with no valid calls the run just ends, and the user sees no error. This re-asks the model
 * with the parse error instead. The correction is never saved: only the final response joins the
 * thread, so the approval gate and the history see one clean step. If it is still malformed after
 * {@link MAX_INVALID_CALL_RETRIES}, the step ends with a visible notice.
 */
export function invalidToolCallMiddleware() {
  return createMiddleware({
    name: "InvalidToolCallRetry",
    wrapModelCall: async (request, handler) => {
      const offered = new Set(request.tools.map((t) => (t as { name?: string }).name ?? ""));
      let response = await handler(request);
      for (let attempt = 0; attempt < MAX_INVALID_CALL_RETRIES; attempt++) {
        const invalid = findInvalidCalls(response);
        if (invalid.length === 0) return response;
        response = await handler({
          ...request,
          messages: [...request.messages, ...correction(response, invalid, offered)],
        });
      }
      const invalid = findInvalidCalls(response);
      return invalid.length === 0 ? response : withNotice(response, invalidCallNotice(invalid));
    },
  });
}
