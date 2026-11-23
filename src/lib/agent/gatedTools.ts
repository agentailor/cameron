/**
 * The tools that write to financial records, or shape such writes. Gated behind human approval
 * by `humanInTheLoopMiddleware` (see `agent/index.ts`). Not every write: `remember` and `forget`
 * only change what Cameron knows, and announce themselves instead (docs/MEMORY.md).
 *
 * This lives in its own module — with NO imports — because client components need it to
 * style the approval gate. `capabilities.ts` pulls in the tool modules, which reach the
 * repositories and `pg`; importing it from the browser drags Postgres into the bundle.
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

export function isGatedTool(name: string): boolean {
  return (GATED_TOOL_NAMES as readonly string[]).includes(name);
}
