import { DEFAULT_SYSTEM_PROMPT as SYSTEM_PROMPT } from "./prompt";
import { postgresCheckpointer } from "./memory";
import type { DynamicTool, StructuredToolInterface } from "@langchain/core/tools";
import {
  AgentConfigOptions,
  createChatModel,
  DEFAULT_MODEL_NAME,
  DEFAULT_MODEL_PROVIDER,
  sanitizeTool,
} from "./util";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { getMCPTools } from "./mcp";
import { financeTools } from "./tools/finance";
import { csvImportTools } from "./tools/csvImport";
import { analyticsTools } from "./tools/analytics";
import { categoryTools } from "./tools/categories";
import { createAgent, humanInTheLoopMiddleware } from "langchain";

/**
 * Built-in tools that MUTATE the ledger. Only these pause for human approval; read-only tools
 * (query_transactions, inspect_csv) and dynamically-loaded MCP tools auto-approve. The names must
 * match the `name` given to each tool in ./tools/*. This is the declarative replacement for the old
 * hand-built `tool_approval` graph node.
 */
const MUTATING_TOOL_NAMES = ["log_expense", "import_transactions_csv", "create_category"] as const;

let setupPromise: Promise<void> | null = null;

/**
 * One-time initialization for the Postgres checkpointer.
 * Ensures the underlying table/extension are ready before any agent runs.
 * This is called automatically when creating an agent via `getAgent` or `ensureAgent`.
 */
async function setupOnce() {
  if (!setupPromise) {
    setupPromise = postgresCheckpointer.setup().catch((err) => {
      // Reset so a future call can retry if initial setup failed.
      setupPromise = null;
      console.error("Failed to setup postgres checkpointer:", err);
      throw err;
    });
  }
  await setupPromise;
}

/**
 * Create a new agent instance with the given configuration.
 * @param cfg Configuration options for the agent
 * @returns
 */
async function buildAgent(cfg?: AgentConfigOptions) {
  // Resolve model/provider from cfg or defaults.
  const provider = cfg?.provider || DEFAULT_MODEL_PROVIDER;
  const modelName = cfg?.model || DEFAULT_MODEL_NAME;
  const llm = createChatModel({ provider, model: modelName, temperature: 1 });

  // Built-in finance tools are registered here (server-side) so they are always present and
  // cannot be omitted by the client. MCP tools are loaded dynamically; per-request config tools
  // are appended too. Approval is enforced per-tool by the HITL middleware below (mutations only).
  const mcpTools = await getMCPTools();
  const configTools = (cfg?.tools || []) as StructuredToolInterface[];

  // Tool definitions stay provider-agnostic (plain Zod). Google Gemini's function-calling API is
  // the outlier — it rejects standard JSON Schema keywords (exclusiveMinimum, format, $defs, …) that
  // Zod emits. So we sanitize built-in tool schemas ONLY when the active provider is Google; other
  // providers (Anthropic, OpenAI) accept the schemas as-is.
  const builtin = [...financeTools, ...csvImportTools, ...analyticsTools, ...categoryTools];
  const builtinTools = (provider === "google"
    ? builtin.map((t) => sanitizeTool(t as unknown as DynamicStructuredTool))
    : builtin) as unknown as StructuredToolInterface[];
  const allTools = [...builtinTools, ...configTools, ...mcpTools] as DynamicTool[];

  // Human-in-the-loop approval: mutating tools pause for an approve/reject decision; everything
  // else (reads, MCP) auto-approves because it isn't listed in `interruptOn`. When the client asks
  // to auto-approve everything, we omit the middleware entirely so no interrupt is ever created.
  const interruptOn = Object.fromEntries(
    MUTATING_TOOL_NAMES.map((name) => [
      name,
      { allowedDecisions: ["approve", "reject"] as ("approve" | "reject")[] },
    ]),
  );
  const middleware = cfg?.approveAllTools
    ? []
    : [
        humanInTheLoopMiddleware({
          interruptOn,
          descriptionPrefix: "This action needs your approval",
        }),
      ];

  const agent = createAgent({
    model: llm,
    tools: allTools,
    systemPrompt: cfg?.systemPrompt || SYSTEM_PROMPT,
    checkpointer: postgresCheckpointer,
    middleware,
    // 25 comfortably covers the CSV inspect→propose→import handshake plus a few tool retries.
  }).withConfig({ recursionLimit: 25 });

  return agent;
}

// Public helper if explicit readiness is ever needed elsewhere.
export async function ensureAgent(cfg?: AgentConfigOptions) {
  // Ensure checkpointer is ready before returning an agent instance.
  await setupOnce();
  return buildAgent(cfg);
}

// Named export to explicitly fetch a configured agent.
export async function getAgent(cfg?: AgentConfigOptions) {
  return ensureAgent(cfg);
}

// Eagerly create a default agent at module load using env defaults.
export const defaultAgent = await ensureAgent();
