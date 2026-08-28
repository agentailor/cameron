/**
 * Which renderer draws each built-in tool's arguments and result.
 *
 * A closed catalog with an open fallback: tools listed here get a purpose-built view, and
 * everything else — every MCP tool, anything added later — falls through to `json`. Adding a
 * tool needs no entry; it just renders as JSON until someone decides it deserves better.
 *
 * Keyed on the tool NAME rather than sniffed from the payload: predicates like `hasRows()` are
 * a second contract that drifts from the payloads they inspect, and this file can be read top
 * to bottom. `config.test.ts` pins every key to a really-registered tool so a rename can't
 * silently drop a tool back to JSON.
 *
 * Tools stay unaware of this: nothing here is imported by the tool modules.
 */

export type ArgsRenderer = "sql" | "filters" | "file" | "expense" | "fields" | "csvPlan" | "json";
export type ResultRenderer = "table" | "receipt" | "json";

export interface ToolRenderers {
  /** null = the call has no arguments worth showing; render the name alone. */
  args: ArgsRenderer | null;
  result: ResultRenderer;
}

export const TOOL_RENDERERS: Record<string, ToolRenderers> = {
  run_sql: { args: "sql", result: "table" },
  query_transactions: { args: "filters", result: "table" },
  list_categories: { args: null, result: "table" },
  describe_finance_schema: { args: null, result: "json" },
  inspect_csv: { args: "file", result: "table" },
  log_expense: { args: "expense", result: "receipt" },
  create_category: { args: "fields", result: "receipt" },
  import_transactions_csv: { args: "csvPlan", result: "receipt" },
};

const FALLBACK: ToolRenderers = { args: "json", result: "json" };

export function renderersFor(toolName: string | undefined): ToolRenderers {
  if (!toolName) return FALLBACK;
  return TOOL_RENDERERS[toolName] ?? FALLBACK;
}
