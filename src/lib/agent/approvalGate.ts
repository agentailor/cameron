import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { createMiddleware, humanInTheLoopMiddleware } from "langchain";
import { pausesFor } from "./gatedTools";

const DESCRIPTION_PREFIX = "This action needs your approval";

type Hook = (state: unknown, runtime: unknown) => unknown;

/** langchain's gate for exactly these names; its `interruptOn` is keyed by name. */
function gateFor(names: string[]): Hook {
  const hitl = humanInTheLoopMiddleware({
    interruptOn: Object.fromEntries(
      names.map((name) => [name, { allowedDecisions: ["approve", "reject"] as const }]),
    ) as Record<string, { allowedDecisions: ("approve" | "reject")[] }>,
    descriptionPrefix: DESCRIPTION_PREFIX,
  });
  const after = hitl.afterModel as unknown as Hook | { hook?: Hook } | undefined;
  const hook = typeof after === "function" ? after : after?.hook;
  // Reaches into langchain's middleware shape, which no type guarantees: fail loud, never open.
  if (typeof hook !== "function") {
    throw new Error("humanInTheLoopMiddleware has no afterModel hook; the approval gate can't run");
  }
  return hook;
}

/**
 * Cameron's approval gate: `humanInTheLoopMiddleware`, with `interruptOn` built per model step
 * from the names the model called, by {@link pausesFor} (`requiresApproval` minus a task's grants). A fixed map would let any name
 * missing from it run unreviewed — such as an MCP tool loaded mid-thread. See docs/MCP_DISCLOSURE.md.
 */
export function approvalGateMiddleware(options: { preApproved?: readonly string[] } = {}) {
  const preApproved: ReadonlySet<string> = new Set(options.preApproved ?? []);
  return createMiddleware({
    name: "ApprovalGate",
    afterModel: {
      canJumpTo: ["model"],
      hook: async (state, runtime) => {
        const messages = (state as { messages?: BaseMessage[] }).messages ?? [];
        const last = [...messages].reverse().find((m) => AIMessage.isInstance(m)) as
          | AIMessage
          | undefined;
        const names = [
          ...new Set(
            (last?.tool_calls ?? []).map((c) => c.name).filter((n) => pausesFor(n, preApproved)),
          ),
        ];
        if (names.length === 0) return;
        // Same names on resume (the node re-runs on the same message), so the interrupt matches.
        return (await gateFor(names)(state, runtime)) as never;
      },
    },
  });
}
