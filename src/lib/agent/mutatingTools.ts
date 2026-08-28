/**
 * The tools that write. Gated behind human approval by `humanInTheLoopMiddleware`
 * (see `agent/index.ts`).
 *
 * This lives in its own module — with NO imports — because client components need it to
 * style the approval gate. `capabilities.ts` pulls in the tool modules, which reach the
 * repositories and `pg`; importing it from the browser drags Postgres into the bundle.
 */
export const MUTATING_TOOL_NAMES = [
  "log_expense",
  "import_transactions_csv",
  "create_category",
] as const;

export function isMutatingTool(name: string): boolean {
  return (MUTATING_TOOL_NAMES as readonly string[]).includes(name);
}
