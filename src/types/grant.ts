/**
 * A tool grant's scope: whose runs it applies to. Only `task` today (id = task name); another kind
 * (a chat thread, a trigger) is a new member here and a new caller of the grant repository.
 */
export type GrantScope = { kind: "task"; id: string };

/** A granted tool, and the MCP server it belongs to (null for Cameron's own tools). */
export interface ToolGrant {
  tool: string;
  serverId: string | null;
}
