import { financeTools } from "./tools/finance";
import { transactionEditTools } from "./tools/transactionEdits";
import { analyticsTools } from "./tools/analytics";
import { categoryTools } from "./tools/categories";
import { configTools } from "./tools/config";
import { chartTools } from "./tools/charts";
import { createMemoryTools } from "./tools/memory";
import { GATED_TOOL_NAMES as GATED_TOOL_NAMES_LOCAL } from "./gatedTools";

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
    name: "read_csv_rows",
    description:
      "Read specific rows of an uploaded CSV by row number, exactly as they appear in the file. " +
      "Used to recover rows an import refused, so they can be fixed one at a time instead of " +
      "re-importing the whole file. Read-only — imports nothing.",
  },
  {
    name: "validate_csv_import",
    description:
      "Check an import plan against the whole file and report what would happen — how many rows " +
      "would import and which would be refused — without writing anything. Required before an " +
      "import runs. Read-only.",
  },
  {
    name: "import_transactions_csv",
    description:
      "Import transactions from an uploaded CSV using a confirmed column mapping and date format. " +
      "Fails loud and imports nothing if a mapped column doesn't exist in the file, or if the " +
      "plan has not been validated first.",
  },
];

// Transcribed for the same reason as the CSV tools above: ./tools/skills reaches the registry,
// which reads the filesystem at module load. capabilities.test.ts pins these to the real tools.
const SKILL_CAPABILITIES = [
  {
    name: "load_skill",
    description:
      "Load a skill's full instructions by name. Skills are listed with a short description in " +
      "the agent's prompt; this fetches the rest on demand. Read-only — runs without approval.",
  },
];

// Transcribed for the same reason as the CSV tools: ./tools/documents reaches the S3 client.
// capabilities.test.ts pins these to the real tools.
const DOCUMENT_CAPABILITIES = [
  {
    name: "read_document",
    description:
      "Read an uploaded image or PDF with the configured model: what kind of document it is, a " +
      "transcription, and for a receipt or invoice the merchant, date, amounts and currency. A " +
      "value it cannot make out is reported as unreadable, never guessed. Read-only.",
  },
  {
    name: "log_from_document",
    description:
      "Log an expense from an uploaded receipt or invoice, linked to the file so it can be traced " +
      "back and is never logged twice. The approval card shows the document beside the values.",
  },
];

/** Tools that mutate the ledger and pause for approval. Names must match ./tools/*. */
export { GATED_TOOL_NAMES } from "./gatedTools";

export interface Capability {
  name: string;
  description: string;
  /** Gated tools pause for human approval; everything else runs unattended. */
  gated: boolean;
  group: string;
}

const GROUPS: { label: string; tools: { name: string; description: string }[] }[] = [
  { label: "Transactions", tools: [...financeTools, ...transactionEditTools] },
  { label: "Categories", tools: categoryTools },
  { label: "CSV import", tools: CSV_IMPORT_CAPABILITIES },
  { label: "Documents", tools: DOCUMENT_CAPABILITIES },
  { label: "Analysis", tools: analyticsTools },
  { label: "Settings", tools: configTools },
  { label: "Charts", tools: chartTools },
  { label: "Skills", tools: SKILL_CAPABILITIES },
  // Built with no memories: the page lists the tools, not what is saved.
  { label: "Memory", tools: createMemoryTools([]) },
];

const gated = new Set<string>(GATED_TOOL_NAMES_LOCAL);

export function listCapabilities(): Capability[] {
  return GROUPS.flatMap(({ label, tools }) =>
    tools.map((t) => ({
      name: t.name,
      description: t.description,
      gated: gated.has(t.name),
      group: label,
    })),
  );
}
