import { buildSystemPrompt } from "./prompt";
import { postgresCheckpointer, setupCheckpointer } from "./memory";
import type { DynamicTool, StructuredToolInterface } from "@langchain/core/tools";
import { AgentConfigOptions, sanitizeTool } from "./util";
import { createChatModel, needsSchemaSanitizing } from "./models";
import { ModelNotConfiguredError, readModelSettings } from "./modelSettings";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { financeTools } from "./tools/finance";
import { transactionEditTools } from "./tools/transactionEdits";
import { csvImportTools } from "./tools/csvImport";
import { analyticsTools } from "./tools/analytics";
import { categoryTools } from "./tools/categories";
import { configTools as settingsTools } from "./tools/config";
import { chartTools } from "./tools/charts";
import { skillTools } from "./tools/skills";
import { listSkills } from "@/lib/skills/registry";
import { createAgent, humanInTheLoopMiddleware } from "langchain";
import { mcpServerDisclosureMiddleware } from "@agentailor/mcp-disclosure";
import { loadDisclosureServers } from "@/lib/mcp/catalog";
import { createToolResolver } from "@/lib/mcp/pool";
// Lives in ./capabilities so the page can read it without importing this file's deps.
import { MUTATING_TOOL_NAMES } from "./capabilities";

async function loadStoredMcp() {
  const { servers, records, catalogs } = await loadDisclosureServers();
  return { servers, resolveTool: createToolResolver(records, catalogs) };
}

/**
 * Create a new agent instance with the given configuration.
 * @param cfg Configuration options for the agent
 * @returns
 */
async function buildAgent(cfg?: AgentConfigOptions) {
  // An explicit pair (the eval harness) bypasses the stored settings entirely.
  let provider: string;
  let modelName: string;
  let baseUrl: string | null = null;
  if (cfg?.provider && cfg?.model) {
    provider = cfg.provider;
    modelName = cfg.model;
    baseUrl = cfg.baseUrl ?? null;
  } else {
    const stored = await readModelSettings();
    if (!stored) throw new ModelNotConfiguredError();
    provider = stored.provider;
    modelName = stored.model;
    baseUrl = stored.baseUrl;
  }
  const llm = createChatModel({ provider, model: modelName, temperature: 1, baseUrl });

  // Built-in finance tools are registered here (server-side) so they are always present and
  // cannot be omitted by the client. MCP tools are NOT registered: the disclosure middleware shows
  // them from the cached catalog and connects to a server only when one of its tools is called.
  // Approval is enforced per-tool by the HITL middleware below (mutations only).
  const mcp = cfg?.mcpForEval ?? (await loadStoredMcp());
  // Per-request tools supplied by the caller — not ./tools/config, which is `settingsTools`.
  const configTools = (cfg?.tools || []) as StructuredToolInterface[];

  // Some function-calling APIs reject JSON Schema keywords Zod emits (format, $defs, …).
  const builtin = [
    ...financeTools,
    ...transactionEditTools,
    ...csvImportTools,
    ...analyticsTools,
    ...categoryTools,
    ...settingsTools,
    ...skillTools,
    ...chartTools,
  ];
  const builtinTools = (needsSchemaSanitizing(provider)
    ? builtin.map((t) => sanitizeTool(t as unknown as DynamicStructuredTool))
    : builtin) as unknown as StructuredToolInterface[];
  const allTools = [...builtinTools, ...configTools] as DynamicTool[];

  // Human-in-the-loop approval: mutating tools pause for an approve/reject decision; everything
  // else (reads, MCP) auto-approves because it isn't listed in `interruptOn`.
  //
  // The middleware is ALWAYS installed for anything reachable from a request — there is no
  // user-facing switch to turn the gate off. `bypassApprovalForEval` omits it for the eval
  // harness alone, which has no human to answer an interrupt (see AgentConfigOptions).
  const interruptOn = Object.fromEntries(
    MUTATING_TOOL_NAMES.map((name) => [
      name,
      { allowedDecisions: ["approve", "reject"] as ("approve" | "reject")[] },
    ]),
  );
  const approval = cfg?.bypassApprovalForEval
    ? []
    : [
        humanInTheLoopMiddleware({
          interruptOn,
          descriptionPrefix: "This action needs your approval",
        }),
      ];
  // Shows the model a list of capabilities and a tool once a search has loaded it, and runs a call
  // on a pooled connection. load_tools is not gated: it only changes visibility.
  const disclosure = mcpServerDisclosureMiddleware(mcp);
  const middleware = [disclosure, ...approval];

  const agent = createAgent({
    model: llm,
    tools: allTools,
    systemPrompt: cfg?.systemPrompt || buildSystemPrompt(listSkills()),
    checkpointer: postgresCheckpointer,
    middleware,
    // Counts graph steps, not tool calls: each model → tool round takes several.
  }).withConfig({ recursionLimit: 50 });

  return agent;
}

// Public helper if explicit readiness is ever needed elsewhere.
export async function ensureAgent(cfg?: AgentConfigOptions) {
  // Ensure checkpointer is ready before returning an agent instance.
  await setupCheckpointer();
  return buildAgent(cfg);
}

// Named export to explicitly fetch a configured agent.
export async function getAgent(cfg?: AgentConfigOptions) {
  return ensureAgent(cfg);
}
