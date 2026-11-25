/**
 * Which tool calls pause for a human decision. The rule is {@link requiresApproval}; the server's
 * gate (`approvalGate.ts`), the resume mapping and the chat UI all use it, so they cannot disagree.
 *
 * This lives in its own module — with NO imports — because client components need it to
 * style the approval gate. `capabilities.ts` pulls in the tool modules, which reach the
 * repositories and `pg`; importing it from the browser drags Postgres into the bundle.
 */

/**
 * The built-in tools that write to financial records, or shape such writes. Not every write:
 * `remember` and `forget` only change what Cameron knows, and announce themselves instead
 * (docs/MEMORY.md).
 */
export const GATED_TOOL_NAMES = [
  "log_expense",
  "import_transactions_csv",
  "create_category",
  "set_config",
  "update_transaction",
  "delete_transaction",
  "log_from_document",
] as const;

/**
 * Writes that are NOT gated: they change what Cameron knows, not the records, and the chat shows
 * each one as it happens (docs/MEMORY.md). Never also in GATED_TOOL_NAMES.
 */
export const ANNOUNCED_TOOL_NAMES = ["remember", "forget"] as const;

/** Must equal `LOAD_TOOLS_TOOL` in `@agentailor/mcp-disclosure` (pinned by a test). */
export const LOAD_TOOLS_TOOL_NAME = "load_tools";

/**
 * Every tool that runs without approval: built-in reads, the announced memory writes, and
 * `load_tools`. An allowlist, so any other name — every MCP tool, whenever it was loaded — is
 * gated. capabilities.test.ts pins it to the registered tools.
 */
export const UNGATED_TOOL_NAMES = [
  "query_transactions",
  "describe_finance_schema",
  "run_sql",
  "list_categories",
  "get_config",
  "inspect_csv",
  "read_csv_rows",
  "validate_csv_import",
  "validate_transaction_update",
  "validate_transaction_delete",
  "read_document",
  "load_skill",
  "render_chart",
  "recall",
  ...ANNOUNCED_TOOL_NAMES,
  LOAD_TOOLS_TOOL_NAME,
] as const;

/** A built-in write. For "does this call pause?", use {@link requiresApproval}. */
export function isGatedTool(name: string): boolean {
  return (GATED_TOOL_NAMES as readonly string[]).includes(name);
}

/** Whether a call to this tool pauses for approval. Unknown names do. */
export function requiresApproval(name: string): boolean {
  return isGatedTool(name) || !(UNGATED_TOOL_NAMES as readonly string[]).includes(name);
}
