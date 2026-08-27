import { financeTools } from "./tools/finance";
import { analyticsTools } from "./tools/analytics";
import { categoryTools } from "./tools/categories";
import { MUTATING_TOOL_NAMES as MUTATING_TOOL_NAMES_LOCAL } from "./mutatingTools";

/**
 * Built-in tools for the /capabilities page, derived from the arrays agent/index.ts registers.
 * Keep this module a LEAF — never import agent/index.ts (the dependency runs the other way).
 */

// Transcribed, not imported: ./tools/csvImport pulls in the S3 client, which throws at module load
// when its env vars are unset. capabilities.test.ts pins these to the real tools.
const CSV_IMPORT_CAPABILITIES = [
  {
    name: "inspect_csv",
    description:
      "Read the header row and first few rows of an uploaded CSV so you can propose a column " +
      "mapping and date format for the user to confirm. Read-only — imports nothing.",
  },
  {
    name: "import_transactions_csv",
    description:
      "Import transactions from an uploaded CSV using a confirmed column mapping and date format. " +
      "Fails loud and imports nothing if a mapped column doesn't exist in the file.",
  },
];

/** Tools that mutate the ledger and pause for approval. Names must match ./tools/*. */
export { MUTATING_TOOL_NAMES } from "./mutatingTools";

export interface Capability {
  name: string;
  description: string;
  /** Mutating tools pause for human approval; reads run unattended. */
  mutating: boolean;
  group: string;
}

const GROUPS: { label: string; tools: { name: string; description: string }[] }[] = [
  { label: "Transactions", tools: financeTools },
  { label: "Categories", tools: categoryTools },
  { label: "CSV import", tools: CSV_IMPORT_CAPABILITIES },
  { label: "Analysis", tools: analyticsTools },
];

const mutating = new Set<string>(MUTATING_TOOL_NAMES_LOCAL);

export function listCapabilities(): Capability[] {
  return GROUPS.flatMap(({ label, tools }) =>
    tools.map((t) => ({
      name: t.name,
      description: t.description,
      mutating: mutating.has(t.name),
      group: label,
    })),
  );
}
