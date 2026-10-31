import { RUN_POLICY } from "../config.mts";
import {
  anyToolCalled,
  loadedToolsAtMost,
  statesAmount,
  statesAnyOf,
  toolCalled,
  toolCalledBefore,
  toolCallCountAtMost,
  toolNotCalled,
} from "../graders.mts";
import { MCP_FIXTURE } from "../mcpMocks.mts";
import type { EvalCase } from "../types.mts";

/**
 * MCP progressive disclosure: the agent sees a short list of capabilities and must search with
 * `load_tools` before it can use one. See docs/MCP_DISCLOSURE.md.
 *
 * Nothing here is checkable without a model. Unit tests prove `load_tools` finds and loads tools,
 * but not that the agent reads the list and searches instead of answering "I don't have access to
 * that", or searches when it needs nothing. Servers are mocks (`eval/mcpMocks.mts`).
 */

// A search returns up to 5, so two searches is what this task can justify.
const MAX_LOADED = 10;

export const cases: EvalCase[] = [
  {
    id: "mcp-loads-tool-before-use",
    description:
      "A question only an MCP server can answer must lead to load_tools, then the right tool, " +
      "then its figure. Answering without loading, or loading half the catalog, is the failure.",
    prompt: "What's the current balance of my checking account at my bank?",
    mcp: true,
    graders: [
      toolCalledBefore("load_tools", MCP_FIXTURE.balanceTool),
      statesAmount(MCP_FIXTURE.balance),
      toolCallCountAtMost("load_tools", 2),
      loadedToolsAtMost(MAX_LOADED),
    ],
    runs: RUN_POLICY.single,
    tags: ["mcp", "disclosure", "ordering"],
  },
  {
    id: "mcp-finds-tool-in-other-words",
    description:
      "The user's words are not the tool's. A search that misses reads as 'I can't do that', so " +
      "the agent must get from a question about the landlord to searching the notes.",
    prompt: "Did I write anything down about my landlord?",
    mcp: true,
    graders: [
      toolCalledBefore("load_tools", MCP_FIXTURE.noteSearchTool),
      statesAnyOf(["1150", "1,150"]),
      toolCallCountAtMost("load_tools", 3),
    ],
    runs: RUN_POLICY.single,
    tags: ["mcp", "disclosure"],
  },
  {
    id: "mcp-ledger-question-loads-nothing",
    description:
      "A question about Cameron's own ledger must not load MCP tools. Loading is a COST defect: " +
      "the answer can still be right while every later step carries the definitions.",
    prompt: "How much have I spent on dining in total?",
    mcp: true,
    graders: [
      toolNotCalled("load_tools"),
      // Without this the negative passes on a run that did nothing.
      anyToolCalled("run_sql", "query_transactions"),
    ],
    runs: RUN_POLICY.single,
    tags: ["mcp", "disclosure"],
  },
  {
    id: "mcp-sign-in-required-is-reported",
    description:
      "A capability needing sign-in cannot be used. The agent must send the user to the " +
      "Connections page rather than claim there are no files or that it has no such ability.",
    prompt: "What files do I have in my cloud drive?",
    mcp: true,
    graders: [
      toolCalled("load_tools"),
      toolNotCalled(`${MCP_FIXTURE.driveServer}__list_files`),
      statesAnyOf(["Connections"]),
    ],
    runs: RUN_POLICY.single,
    tags: ["mcp", "disclosure"],
  },
];
