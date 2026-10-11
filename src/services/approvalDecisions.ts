import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { Decision, HITLRequest } from "langchain";
import type { ApprovalDecision } from "@/types/message";
import { isMutatingTool } from "@/lib/agent/mutatingTools";

/**
 * Turns the client's per-call decisions into the middleware's positional `decisions` array.
 *
 * `humanInTheLoopMiddleware` batches every gated call of one AI message into one interrupt and
 * aligns decisions by POSITION, while its `actionRequests` carry no call id. The client decides by
 * call id, so the order is rebuilt from the paused AI message's gated calls — and checked against
 * the action requests, because a wrong alignment approves a call the user never clicked.
 *
 * Pure (no graph, no DB) so the mapping is unit-tested. Every doubt is a refusal: a decision is
 * never defaulted, and never copied from another call.
 */

export const DENIED_MESSAGE = "The user denied this action.";

/**
 * Sent for an APPROVED call in a batch that also has a denial. The middleware drops approved
 * siblings when anything is rejected and returns to the model, so without this the call would
 * vanish from the history and the model could believe it ran.
 */
export const HELD_BACK_MESSAGE =
  "Not run. The user APPROVED this action, but denied another one requested in the same step, " +
  "and a denial sends the whole step back to you. Request this action again to run it; it will " +
  "be reviewed again.";

/** A gated tool call on the paused AI message, in the order the middleware saw it. */
export interface PausedCall {
  id: string;
  name: string;
  args: unknown;
}

export interface PendingAction {
  name: string;
  args: unknown;
}

export interface PendingBatch {
  actionRequests: PendingAction[];
  pausedCalls: PausedCall[];
}

/** Snapshot shape read here: `agent.graph.getState()`'s tasks and values. */
export interface GraphSnapshot {
  tasks?: { interrupts?: { value: unknown }[] }[];
  values?: { messages?: BaseMessage[] };
}

/**
 * The batch a thread is paused on. Shared by the app's resume path and the eval harness, so both
 * answer the gate the same way. The middleware gates the LAST AI message's calls, in order.
 */
export function readPendingBatch(snapshot: GraphSnapshot): PendingBatch {
  const pending = snapshot.tasks
    ?.flatMap((t) => t.interrupts ?? [])
    .map((i) => i.value as HITLRequest | undefined)
    .find((v) => v && Array.isArray(v.actionRequests));

  const messages = snapshot.values?.messages ?? [];
  const paused = [...messages].reverse().find((m) => AIMessage.isInstance(m)) as
    | AIMessage
    | undefined;

  return {
    actionRequests: (pending?.actionRequests ?? []).map((a) => ({ name: a.name, args: a.args })),
    pausedCalls: (paused?.tool_calls ?? [])
      .filter((c) => isMutatingTool(c.name))
      .map((c) => ({ id: c.id ?? "", name: c.name, args: c.args })),
  };
}

export type ResolvedDecisions = { ok: true; decisions: Decision[] } | { ok: false; error: string };

const refuse = (error: string): ResolvedDecisions => ({ ok: false, error });

export function resolveDecisions(input: {
  actionRequests: PendingAction[];
  pausedCalls: PausedCall[];
  decisions: Record<string, ApprovalDecision>;
}): ResolvedDecisions {
  const { actionRequests, pausedCalls, decisions } = input;

  if (actionRequests.length === 0) return refuse("Nothing is awaiting approval in this thread.");

  const aligned =
    pausedCalls.length === actionRequests.length &&
    pausedCalls.every(
      (call, i) =>
        call.name === actionRequests[i].name &&
        JSON.stringify(call.args) === JSON.stringify(actionRequests[i].args),
    );
  if (!aligned) {
    return refuse("The pending approvals could not be matched to their tool calls; nothing ran.");
  }

  const pausedIds = new Set(pausedCalls.map((c) => c.id));
  const unknown = Object.keys(decisions).filter((id) => !pausedIds.has(id));
  if (unknown.length > 0) {
    return refuse(`Decision for a call that is not awaiting approval: ${unknown.join(", ")}.`);
  }

  const missing = pausedCalls.filter((c) => !Object.hasOwn(decisions, c.id)).map((c) => c.id);
  if (missing.length > 0) {
    return refuse(`Every pending call needs a decision; missing: ${missing.join(", ")}.`);
  }

  const invalid = pausedCalls.filter(
    (c) => decisions[c.id] !== "allow" && decisions[c.id] !== "deny",
  );
  if (invalid.length > 0) {
    return refuse(`A decision must be "allow" or "deny": ${invalid.map((c) => c.id).join(", ")}.`);
  }

  const anyDenied = pausedCalls.some((c) => decisions[c.id] === "deny");
  return {
    ok: true,
    decisions: pausedCalls.map((call): Decision => {
      if (decisions[call.id] === "deny") return { type: "reject", message: DENIED_MESSAGE };
      return anyDenied ? { type: "reject", message: HELD_BACK_MESSAGE } : { type: "approve" };
    }),
  };
}
