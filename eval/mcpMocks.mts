import { tool } from "langchain";
import { z } from "zod";
import type {
  DisclosureServer,
  McpToolDefinition,
  ResolveMcpTool,
  ToolResolution,
} from "@agentailor/mcp-disclosure";

/**
 * In-process mock MCP servers: catalog rows and canned results, with no connection. These cases
 * test whether the model finds and uses a capability for a task, so real servers would only add
 * MCP plumbing, network and cost to what is graded.
 *
 * Server and tool wording is written like real servers' — the search has to work on it, and a
 * description naming the case's exact words would make the case pass for the wrong reason.
 */

export const MCP_FIXTURE = {
  balance: 4217.35,
  balanceTool: "bank__get_account_balance",
  noteSearchTool: "notes__search_notes",
  landlordNote: "Landlord raises rent to 1150 in March",
  driveServer: "drive",
} as const;

const objectSchema = (properties: Record<string, { type: string; description: string }> = {}) => ({
  type: "object",
  properties,
});

type MockTool = McpToolDefinition & { result: unknown };

const MOCKS: { name: string; summary: string; authRequired?: boolean; tools: MockTool[] }[] = [
  {
    name: "bank",
    summary: "Live data from the owner's bank: accounts, balances and recent card activity.",
    tools: [
      {
        name: "get_account_balance",
        description: "Current available balance of one account.",
        inputSchema: objectSchema({
          account: { type: "string", description: "checking or savings" },
        }),
        result: { account: "checking", balance: MCP_FIXTURE.balance, currency: "USD" },
      },
      {
        name: "list_accounts",
        description: "Accounts held at the bank, with their type.",
        inputSchema: objectSchema(),
        result: { accounts: ["checking", "savings"] },
      },
      {
        name: "list_card_activity",
        description: "Recent card payments, newest first.",
        inputSchema: objectSchema({ days: { type: "number", description: "How far back" } }),
        result: { payments: [] },
      },
      {
        name: "get_iban",
        description: "IBAN and routing details of an account.",
        inputSchema: objectSchema({
          account: { type: "string", description: "checking or savings" },
        }),
        result: { iban: "XX00 0000" },
      },
    ],
  },
  {
    name: "notes",
    summary: "The owner's personal notes.",
    tools: [
      {
        name: "search_notes",
        description: "Full-text search across all notes. Returns matching notes.",
        inputSchema: objectSchema({ text: { type: "string", description: "Words to look for" } }),
        result: { notes: [MCP_FIXTURE.landlordNote] },
      },
      {
        name: "read_note",
        description: "Read one note by its id.",
        inputSchema: objectSchema({ id: { type: "string", description: "Note id" } }),
        result: { note: MCP_FIXTURE.landlordNote },
      },
      {
        name: "list_notebooks",
        description: "List notebooks.",
        inputSchema: objectSchema(),
        result: { notebooks: ["Home"] },
      },
    ],
  },
  {
    name: MCP_FIXTURE.driveServer,
    summary: "Files in the owner's cloud drive.",
    authRequired: true,
    tools: [
      {
        name: "list_files",
        description: "List files in a folder.",
        inputSchema: objectSchema({ folder: { type: "string", description: "Folder path" } }),
        result: { files: [] },
      },
    ],
  },
];

export const mockServers: DisclosureServer[] = MOCKS.map((m) => ({
  id: `mock-${m.name}`,
  name: m.name,
  authRequired: m.authRequired ?? false,
  catalog: {
    serverId: `mock-${m.name}`,
    toolsHash: "mock",
    tools: m.tools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
    toolCount: m.tools.length,
    schemaTokens: 0,
    summary: m.summary,
    summarySource: "heuristic",
    refreshedAt: new Date(0),
  },
}));

export const mockResolveTool: ResolveMcpTool = async (serverId, toolName) => {
  const server = MOCKS.find((m) => `mock-${m.name}` === serverId);
  const mock = server?.tools.find((t) => t.name === toolName);
  if (!server || !mock) return { ok: false, error: "connect_failed", message: "no such mock" };
  const real = tool(async () => JSON.stringify(mock.result), {
    name: `${server.name}__${toolName}`,
    description: mock.description ?? "",
    schema: z.object({}).passthrough(),
  });
  // .mts resolves @langchain/core's ESM types and the package its CJS ones: same class at runtime.
  return { ok: true, tool: real } as unknown as ToolResolution;
};
