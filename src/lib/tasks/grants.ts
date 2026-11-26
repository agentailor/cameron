import {
  GATED_TOOL_NAMES,
  isGatedTool,
  isNeverGrantable,
  requiresApproval,
} from "@/lib/agent/gatedTools";

/**
 * Which tools the owner can grant, and what granting one means. A pure leaf (gatedTools is
 * zero-import), shared by the server and the page. See docs/GRANTS.md.
 */

/**
 * What a granted call can do, shown beside it. A description, not a rule: the owner decides.
 * `adds`: creates a record you can delete. `changes`: overwrites a value in place. `bulk`: adds
 * many records at once. `external`: a tool from a connected server; Cameron can't tell.
 */
export type BuiltInRisk = "adds" | "changes" | "bulk";
export type GrantRisk = BuiltInRisk | "external";

/** Every built-in write except the never-grantable ones; a test pins it to GATED_TOOL_NAMES. */
export const BUILT_IN_RISK: Record<string, BuiltInRisk> = {
  log_expense: "adds",
  log_from_document: "adds",
  create_category: "adds",
  update_transaction: "changes",
  set_config: "changes",
  import_transactions_csv: "bulk",
};

export type GrantInfo =
  | { status: "grantable"; risk: GrantRisk }
  /** Never grantable (a hard delete). */
  | { status: "never" }
  /** Already runs without approval; granting changes nothing. */
  | { status: "already_runs" };

export function grantInfo(name: string): GrantInfo {
  if (isNeverGrantable(name)) return { status: "never" };
  if (!requiresApproval(name)) return { status: "already_runs" };
  return { status: "grantable", risk: isGatedTool(name) ? BUILT_IN_RISK[name] : "external" };
}

export function isGrantable(name: string): boolean {
  return grantInfo(name).status === "grantable";
}

/** The built-in tools the grant editor lists: every write, never-grantable ones included. */
export const BUILT_IN_WRITES: readonly string[] = GATED_TOOL_NAMES;
