import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

type Part = Record<string, unknown>;

export interface SemconvMessage {
  role: string;
  parts: Part[];
  finish_reason?: string;
}

const ROLES: Record<string, string> = { human: "user", ai: "assistant", tool: "tool" };

function contentParts(content: BaseMessage["content"]): Part[] {
  if (typeof content === "string") return content ? [{ type: "text", content }] : [];
  return content.map((block) => {
    const b = block as { type?: string; text?: string };
    // Non-text blocks (images, files) are named, never inlined: they can be megabytes of base64.
    return b.type === "text"
      ? { type: "text", content: b.text ?? "" }
      : { type: b.type ?? "unknown" };
  });
}

function toParts(m: BaseMessage): Part[] {
  const parts = contentParts(m.content);
  if (AIMessage.isInstance(m)) {
    for (const call of m.tool_calls ?? []) {
      parts.push({ type: "tool_call", id: call.id, name: call.name, arguments: call.args });
    }
  }
  if (ToolMessage.isInstance(m)) {
    return [{ type: "tool_call_response", id: m.tool_call_id, response: m.content }];
  }
  return parts;
}

/** Splits a chat model's input into semconv system instructions and messages. */
export function toSemconvInput(messages: BaseMessage[]): {
  systemInstructions: Part[];
  messages: SemconvMessage[];
} {
  const systemInstructions: Part[] = [];
  const out: SemconvMessage[] = [];
  for (const m of messages) {
    const type = m.getType();
    if (type === "system") systemInstructions.push(...contentParts(m.content));
    else out.push({ role: ROLES[type] ?? type, parts: toParts(m) });
  }
  return { systemInstructions, messages: out };
}

export function toSemconvOutput(message: BaseMessage, finishReason?: string): SemconvMessage[] {
  return [
    {
      role: "assistant",
      parts: toParts(message),
      ...(finishReason ? { finish_reason: finishReason } : {}),
    },
  ];
}
