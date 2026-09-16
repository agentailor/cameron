import type { BaseMessage } from "@langchain/core/messages";
import type {
  AIMessageData,
  BasicMessageData,
  MessageResponse,
  ToolCall,
  ToolMessageData,
} from "@/types/message";

// `toDict()` is LangChain's serialization, not our wire contract — casting it shipped every
// field it carries. Projecting explicitly keeps `MessageResponse` the actual shape.

/** Keep a key only when it carries information. */
function put<T extends object>(target: T, key: keyof T, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value) && value.length === 0) return;
  if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return;
  (target as Record<string, unknown>)[key as string] = value;
}

type ContentBlock = { type?: string; id?: string };

/** True when `content` only restates `tool_calls`. Mixed content keeps its prose. */
function isRedundantToolCallContent(content: unknown, toolCalls: ToolCall[] | undefined): boolean {
  if (!Array.isArray(content) || content.length === 0) return false;
  if (!toolCalls || toolCalls.length === 0) return false;
  const ids = new Set(toolCalls.map((call) => call.id));
  return (content as ContentBlock[]).every(
    (block) => block?.type === "tool_call" && !!block.id && ids.has(block.id),
  );
}

/** `toDict()` output — `data` carries provider fields beyond LangChain's declared type. */
type CheckpointMessage = {
  type?: string;
  data?: Record<string, unknown>;
};

function projectMessage(raw: CheckpointMessage): MessageResponse {
  const type = raw.type;
  const d = raw.data ?? {};

  if (type === "ai") {
    const data = {} as AIMessageData;
    const toolCalls = d.tool_calls as ToolCall[] | undefined;
    put(data, "id", d.id);
    if (!isRedundantToolCallContent(d.content, toolCalls)) put(data, "content", d.content);
    put(data, "tool_calls", toolCalls);
    put(data, "pendingToolCallIds", d.pendingToolCallIds);
    return { type: "ai", data };
  }

  if (type === "tool") {
    const data = {} as ToolMessageData;
    put(data, "id", d.id);
    put(data, "content", d.content);
    put(data, "tool_call_id", d.tool_call_id);
    put(data, "name", d.name);
    put(data, "status", d.status);
    // A chart renders from its artifact, not from content — dropping it blanks the chart.
    put(data, "artifact", d.artifact);
    return { type: "tool", data };
  }

  // Human: attachments ride inside the content array, so it passes through untouched.
  const data = {} as BasicMessageData;
  put(data, "id", d.id);
  put(data, "content", d.content);
  put(data, "attachments", d.attachments);
  return { type: type === "error" ? "error" : "human", data };
}

/** Project a checkpoint's messages onto the fields the UI reads. */
export function projectHistory(messages: BaseMessage[]): MessageResponse[] {
  return messages.map((msg) => projectMessage(msg.toDict() as unknown as CheckpointMessage));
}

/** Exported for tests, which feed plain `toDict()` output. */
export const __projectMessage = projectMessage;
