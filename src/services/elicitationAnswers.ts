import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import { prefixedToolName } from "@agentailor/mcp-disclosure";
import {
  answerProblem,
  type ElicitationAction,
  type ElicitationAnswers,
  type ElicitationRequest,
  type ElicitationResponses,
  type PendingElicitation,
} from "@/lib/mcp/elicitation";

/**
 * Reads the server questions a thread is paused on and turns the owner's answers into the resume.
 * Pure (no graph, no DB), like approvalDecisions.ts, and every doubt is a refusal: an answer is
 * never defaulted. See docs/MCP_ELICITATION.md.
 */

/** A checkpoint interrupt: `id` addresses the resume, `value` is the adapter's payload. */
export interface RawInterrupt {
  id?: string;
  value?: unknown;
}

interface ElicitationPayload {
  type: "mcp_elicitation";
  server: string;
  tool: string;
  arguments?: Record<string, unknown>;
  requests: Record<string, ElicitationRequest>;
}

function isElicitation(value: unknown): value is ElicitationPayload {
  const v = value as Partial<ElicitationPayload> | null;
  return (
    !!v &&
    v.type === "mcp_elicitation" &&
    typeof v.server === "string" &&
    typeof v.tool === "string" &&
    !!v.requests &&
    typeof v.requests === "object"
  );
}

const sameArgs = (a: unknown, b: unknown) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

/**
 * The questions pending in `interrupts`, each matched to the unanswered call that raised it. The
 * adapter's payload carries no call id, so the match is by tool name and arguments, like
 * `readPendingBatch`. It only places the card: the resume is addressed by interrupt id.
 */
export function readPendingElicitations(
  interrupts: RawInterrupt[],
  messages: BaseMessage[],
): PendingElicitation[] {
  const asked = interrupts.filter(
    (i): i is { id: string; value: ElicitationPayload } => !!i.id && isElicitation(i.value),
  );
  if (asked.length === 0) return [];

  const lastAi = [...messages].reverse().find((m) => AIMessage.isInstance(m)) as
    | AIMessage
    | undefined;
  const answered = new Set(
    messages.filter((m) => ToolMessage.isInstance(m)).map((m) => (m as ToolMessage).tool_call_id),
  );
  const open = (lastAi?.tool_calls ?? []).filter((c) => c.id && !answered.has(c.id));
  const claimed = new Set<string>();
  const claim = (predicate: (c: (typeof open)[number]) => boolean) => {
    const call = open.find((c) => !claimed.has(c.id!) && predicate(c));
    if (call) claimed.add(call.id!);
    return call?.id;
  };

  return asked.map(({ id, value }) => {
    const name = prefixedToolName(value.server, value.tool);
    const toolCallId =
      claim((c) => c.name === name && sameArgs(c.args, value.arguments)) ??
      claim((c) => c.name === name);
    return {
      interruptId: id,
      ...(toolCallId ? { toolCallId } : {}),
      server: value.server,
      tool: value.tool,
      requests: value.requests,
    };
  });
}

export type ResolvedAnswers =
  | {
      ok: true;
      /** The resume value: each interrupt id to the adapter's `{ responses }`. */
      resume: Record<string, { responses: ElicitationResponses }>;
      /** Per matched call, what the owner chose; a decline or cancel adds a note to the result. */
      outcomes: Record<string, ElicitationAction>;
    }
  | { ok: false; error: string };

const refuse = (error: string): ResolvedAnswers => ({ ok: false, error });

/** The answer's overall outcome: any decline wins, then any cancel. */
function outcomeOf(responses: ElicitationResponses): ElicitationAction {
  const actions = Object.values(responses).map((r) => r.action);
  if (actions.includes("decline")) return "decline";
  if (actions.includes("cancel")) return "cancel";
  return "accept";
}

export function resolveElicitationAnswers(input: {
  pending: PendingElicitation[];
  answers: ElicitationAnswers;
}): ResolvedAnswers {
  const { pending, answers } = input;
  if (pending.length === 0) return refuse("No server request is waiting in this thread.");

  const pendingIds = new Set(pending.map((p) => p.interruptId));
  const unknown = Object.keys(answers).filter((id) => !pendingIds.has(id));
  if (unknown.length > 0)
    return refuse(`Answer for a request that is not waiting: ${unknown.join(", ")}.`);
  const missing = pending.filter((p) => !Object.hasOwn(answers, p.interruptId));
  if (missing.length > 0) {
    return refuse(
      `Every waiting request needs an answer; missing: ${missing.map((p) => p.interruptId).join(", ")}.`,
    );
  }

  const resume: Record<string, { responses: ElicitationResponses }> = {};
  const outcomes: Record<string, ElicitationAction> = {};
  for (const p of pending) {
    const responses = answers[p.interruptId];
    const keys = Object.keys(p.requests);
    const given = Object.keys(responses ?? {});
    if (given.length !== keys.length || !keys.every((k) => Object.hasOwn(responses, k))) {
      return refuse(`The answer to ${p.server} must cover exactly: ${keys.join(", ")}.`);
    }
    for (const key of keys) {
      const problem = answerProblem(p.requests[key], responses[key]);
      if (problem) return refuse(`The answer to ${p.server} was not sent: ${problem}.`);
    }
    resume[p.interruptId] = { responses };
    if (p.toolCallId) outcomes[p.toolCallId] = outcomeOf(responses);
  }
  return { ok: true, resume, outcomes };
}

/** Every request declined: the answer when no one is there (the eval harness). */
export function declineAll(pending: PendingElicitation[]): ElicitationAnswers {
  return Object.fromEntries(
    pending.map((p) => [
      p.interruptId,
      Object.fromEntries(Object.keys(p.requests).map((k) => [k, { action: "decline" as const }])),
    ]),
  );
}

/** Built here, not by the caller, for the same ESM/CJS reason as `toResumeCommand`. */
export function toElicitationResume(resume: Record<string, { responses: ElicitationResponses }>) {
  return new Command({ resume });
}
