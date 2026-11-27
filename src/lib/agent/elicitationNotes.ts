import { createMiddleware } from "langchain";
import { ToolMessage } from "@langchain/core/messages";
import { getConfig } from "@langchain/langgraph";
import { withheldNote, type ElicitationAction } from "@/lib/mcp/elicitation";

/**
 * A server the owner declined often answers with an empty-looking success (its content withheld),
 * which the agent reads as "nothing found". The resume passes the owner's choice per call id under
 * this configurable key, and the middleware adds a note to that call's result.
 */
export const ELICITATION_OUTCOMES_KEY = "cameron_elicitation_outcomes";

type Outcomes = Record<string, ElicitationAction>;

function outcomesFrom(configurable: unknown): Outcomes | undefined {
  const value = (configurable as Record<string, unknown> | undefined)?.[ELICITATION_OUTCOMES_KEY];
  return value && typeof value === "object" ? (value as Outcomes) : undefined;
}

function currentOutcomes(runtimeConfigurable: unknown): Outcomes | undefined {
  const fromRuntime = outcomesFrom(runtimeConfigurable);
  if (fromRuntime) return fromRuntime;
  try {
    return outcomesFrom(getConfig()?.configurable);
  } catch {
    return undefined; // outside a runnable context
  }
}

/** The result with the note added, in whatever shape its content has. */
export function withNote(message: ToolMessage, note: string): ToolMessage {
  const content = message.content;
  const noted =
    typeof content === "string"
      ? `${content}\n\n[cameron] ${note}`
      : [...(content as object[]), { type: "text", text: `[cameron] ${note}` }];
  return new ToolMessage({
    content: noted as ToolMessage["content"],
    tool_call_id: message.tool_call_id,
    name: message.name,
    status: message.status,
    artifact: message.artifact,
    id: message.id,
  });
}

/** The server part of a `server_tool` name, for the note's wording. */
const serverOf = (toolName: string) => toolName.split("_")[0] || toolName;

export function elicitationNoteMiddleware() {
  return createMiddleware({
    name: "ElicitationNotes",
    wrapToolCall: async (request, handler) => {
      const result = await handler(request);
      const id = request.toolCall.id;
      const action = id ? currentOutcomes(request.runtime?.configurable)?.[id] : undefined;
      if (!ToolMessage.isInstance(result) || (action !== "decline" && action !== "cancel")) {
        return result;
      }
      return withNote(result, withheldNote(action, serverOf(request.toolCall.name)));
    },
  });
}
