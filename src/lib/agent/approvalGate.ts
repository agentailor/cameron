import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { createMiddleware, humanInTheLoopMiddleware } from "langchain";
import { requiresApproval } from "./gatedTools";

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
  const after = hitl.afterModel as unknown as Hook | { hook: Hook };
  return typeof after === "function" ? after : after.hook;
}

/**
 * Cameron's approval gate: `humanInTheLoopMiddleware`, with `interruptOn` built per model step
 * from the names the model called, by {@link requiresApproval}. A fixed map would let any name
 * missing from it run unreviewed — such as an MCP tool loaded mid-thread. See docs/MCP_DISCLOSURE.md.
 */
export function approvalGateMiddleware() {
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
          ...new Set((last?.tool_calls ?? []).map((c) => c.name).filter(requiresApproval)),
        ];
        if (names.length === 0) return;
        // Same names on resume (the node re-runs on the same message), so the interrupt matches.
        return (await gateFor(names)(state, runtime)) as never;
      },
    },
  });
}
