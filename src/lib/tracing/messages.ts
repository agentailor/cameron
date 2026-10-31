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
    const type = m.type;
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

export interface SemconvToolDefinition {
  type: "function";
  name: string;
  description?: string;
  parameters?: unknown;
}

/**
 * The tools a model call was given, from LangChain's `invocation_params.tools`, in the semconv
 * shape. Each provider binds them differently: OpenAI `{ type, function: {...} }`, Anthropic
 * `{ name, input_schema }`, Gemini `[{ functionDeclarations: [...] }]`. Anything else (a
 * provider-native tool without a schema) is skipped rather than guessed at.
 */
export function toSemconvToolDefinitions(tools: unknown): SemconvToolDefinition[] {
  if (!Array.isArray(tools)) return [];
  const out: SemconvToolDefinition[] = [];
  const push = (name: unknown, description: unknown, parameters: unknown) => {
    if (typeof name !== "string") return;
    out.push({
      type: "function",
      name,
      ...(typeof description === "string" && description ? { description } : {}),
      ...(parameters !== undefined ? { parameters } : {}),
    });
  };
  for (const raw of tools) {
    const t = (raw ?? {}) as Record<string, unknown>;
    const fn = t.function as Record<string, unknown> | undefined;
    if (fn) push(fn.name, fn.description, fn.parameters);
    else if (Array.isArray(t.functionDeclarations)) {
      for (const d of t.functionDeclarations as Record<string, unknown>[]) {
        push(d?.name, d?.description, d?.parameters);
      }
    } else push(t.name, t.description, t.input_schema ?? t.parameters);
  }
  return out;
}
