import type { MessageResponse, ToolCall } from "@/types/message";
import { isMutatingTool } from "@/lib/agent/mutatingTools";
import {
  getMessageContent,
  getPendingToolCallIds,
  getToolCalls,
  isToolMessage,
} from "./messageUtils";

/**
 * Pairs each tool CALL with the RESULT that answers it, so one operation renders as one card.
 *
 * The wire delivers them as two separate messages — the call on an AI message, the result as its
 * own `tool` message — which is why the UI used to draw two. Pairing is by `tool_call_id`, never
 * by adjacency: results arrive when they resolve, and a paused call never gets one at all.
 */

/** One tool call and whatever is known about its outcome. */
export interface ToolActivity {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  /** The result message, or null while the call is still running or awaiting approval. */
  result: MessageResponse | null;
  /** Held at the approval gate: the user must decide before anything runs. */
  isPending: boolean;
  /** Writes, per `MUTATING_TOOL_NAMES`. Its arguments are always shown. */
  isMutating: boolean;
}

/** A consecutive run of tool calls, rendered as a single collapsible card. */
export interface ToolActivityGroup {
  kind: "tools";
  id: string;
  activities: ToolActivity[];
}

export interface PlainMessageItem {
  kind: "message";
  id: string;
  message: MessageResponse;
}

export type ThreadItem = ToolActivityGroup | PlainMessageItem;

/**
 * Fold a repeated message's fields into the one already kept. Only additive fields are copied —
 * a later chunk never blanks text the first one carried.
 */
function mergeInto(target: MessageResponse, extra: MessageResponse): void {
  const from = extra.data as unknown as Record<string, unknown> | undefined;
  const into = target.data as unknown as Record<string, unknown>;
  if (!from) return;
  if (Array.isArray(from.tool_calls) && from.tool_calls.length > 0) {
    into.tool_calls = from.tool_calls;
  }
  if (Array.isArray(from.pendingToolCallIds) && from.pendingToolCallIds.length > 0) {
    into.pendingToolCallIds = from.pendingToolCallIds;
  }
  if (typeof from.content === "string" && from.content.trim() !== "" && !into.content) {
    into.content = from.content;
  }
}

/**
 * AI text worth rendering, ignoring tool calls riding on the same message.
 *
 * Uses the SAME extraction the renderer uses. A replayed history stores content as an array whose
 * blocks include `tool_call` entries, so checking array LENGTH would count a calls-only message as
 * text — breaking the group and rendering an empty bubble.
 */
function hasVisibleText(message: MessageResponse): boolean {
  return getMessageContent(message).trim() !== "";
}

/**
 * Flattens a thread into render-ready items, grouping consecutive tool calls.
 *
 * Results are consumed out of the list by id, so a result never renders on its own — that
 * double-rendering is what the old two-component layout did.
 */
export function buildThreadItems(input: MessageResponse[]): ThreadItem[] {
  // Dedup by type+id: ids are unique only WITHIN a type (an AI message's synthetic id and a tool
  // message's call id are different namespaces), so keying on id alone can drop a real message.
  //
  // Repeats are MERGED rather than discarded. The server sends the pending-approval marker as its
  // own chunk bearing the id of the message that made the call; dropping it outright would throw
  // the approval gate away in any shape where that chunk stayed a separate message.
  const byKey = new Map<string, MessageResponse>();
  const messages: MessageResponse[] = [];
  for (const message of input) {
    const id = message.data?.id;
    if (!id) {
      messages.push(message);
      continue;
    }
    const key = `${message.type}:${id}`;
    const existing = byKey.get(key);
    if (!existing) {
      const copy = { ...message, data: { ...message.data } } as MessageResponse;
      byKey.set(key, copy);
      messages.push(copy);
      continue;
    }
    mergeInto(existing, message);
  }

  // Index every result by the call it answers, so a call can find its result wherever it landed.
  const resultsByCallId = new Map<string, MessageResponse>();
  const knownCallIds = new Set<string>();
  // Pending ids are collected across the WHOLE thread, not per message. Streaming merges the
  // pending chunk into the message that made the call, but a replayed history can carry it on a
  // separate one — reading it per message would silently lose the gate in that shape.
  const pendingCallIds = new Set<string>();
  for (const message of messages) {
    if (isToolMessage(message)) resultsByCallId.set(message.data.tool_call_id, message);
    else if (message.type === "ai") {
      for (const call of getToolCalls(message)) knownCallIds.add(call.id);
      for (const id of getPendingToolCallIds(message)) pendingCallIds.add(id);
    }
  }

  const items: ThreadItem[] = [];
  let openGroup: ToolActivityGroup | null = null;

  const pushActivity = (activity: ToolActivity, groupId: string) => {
    if (!openGroup) {
      openGroup = { kind: "tools", id: groupId, activities: [] };
      items.push(openGroup);
    }
    openGroup.activities.push(activity);
  };

  for (const [index, message] of messages.entries()) {
    if (isToolMessage(message)) {
      // Already rendered inside its call's card. An orphan (a result whose call never streamed)
      // still deserves a card rather than vanishing.
      const callId = message.data.tool_call_id;
      if (knownCallIds.has(callId)) continue;
      pushActivity(
        {
          callId,
          name: message.data.name,
          args: {},
          result: message,
          isPending: false,
          isMutating: isMutatingTool(message.data.name),
        },
        `tools-${message.data.id || index}`,
      );
      continue;
    }

    if (message.type === "ai") {
      const toolCalls = getToolCalls(message);

      if (hasVisibleText(message)) {
        // Text ends any open run: the agent said something between the calls.
        openGroup = null;
        items.push({ kind: "message", id: `ai-${message.data?.id || index}`, message });
      } else if (toolCalls.length === 0) {
        // No text and no calls: nothing a reader can see.
        continue;
      }

      for (const call of toolCalls) {
        pushActivity(
          toActivity(call, resultsByCallId, pendingCallIds),
          `tools-${message.data?.id || index}`,
        );
      }
      continue;
    }

    openGroup = null;
    items.push({ kind: "message", id: `${message.type}-${message.data?.id || index}`, message });
  }

  return items;
}

function toActivity(
  call: ToolCall,
  resultsByCallId: Map<string, MessageResponse>,
  pending: Set<string>,
): ToolActivity {
  const result = resultsByCallId.get(call.id) ?? null;
  return {
    callId: call.id,
    name: call.name,
    args: call.args ?? {},
    result,
    // A result settles the question: a call that ran is no longer awaiting a decision.
    isPending: result === null && pending.has(call.id),
    isMutating: isMutatingTool(call.name),
  };
}
