import { DynamicStructuredTool, type StructuredToolInterface } from "@langchain/core/tools";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DisclosureServer,
  McpToolDefinition,
  ResolveMcpTool,
  ToolResolution,
} from "@agentailor/mcp-disclosure";
// By path: the package's named value exports don't survive this tree's CJS interop.
import { prefixedToolName } from "../../packages/mcp-disclosure/src/policy.ts";

/**
 * The benchmark's servers: three small CORE servers that hold every task's answer, plus
 * DISTRACTORS — `tools/list` snapshots of real servers (`snapshots/*.json`), which no task needs.
 * A scale of N is the core plus the first N-3 snapshots, so a larger scale only adds distractors.
 */

export const BENCH_FIXTURE = {
  checkingBalance: 4217.35,
  savingsIban: "DE89 3704 0044 0532 0130 00",
  cardMerchant: "Hornbach",
  notebook: "Travel",
  landlordRent: "1150",
  boilerDate: "14 April",
  nextEvent: "Dentist",
} as const;

type Args = Record<string, unknown>;
type CoreTool = McpToolDefinition & { result: (args: Args) => unknown };

const object = (properties: Record<string, { type: string; description: string }> = {}) => ({
  type: "object",
  properties,
});

const NOTES = [
  {
    id: "n-17",
    title: "Flat",
    text: `Landlord raises rent to ${BENCH_FIXTURE.landlordRent} in March`,
  },
  { id: "n-22", title: "Heating", text: `Boiler service booked for ${BENCH_FIXTURE.boilerDate}` },
];

const CORE: { name: string; summary: string; tools: CoreTool[] }[] = [
  {
    name: "bank",
    summary: "Live data from the owner's bank: accounts, balances and recent card activity.",
    tools: [
      {
        name: "get_account_balance",
        description: "Current available balance of one account.",
        inputSchema: object({ account: { type: "string", description: "checking or savings" } }),
        result: (a) =>
          String(a.account).toLowerCase().includes("sav")
            ? { account: "savings", balance: 12850.5, currency: "USD" }
            : { account: "checking", balance: BENCH_FIXTURE.checkingBalance, currency: "USD" },
      },
      {
        name: "list_accounts",
        description: "Accounts held at the bank, with their type.",
        inputSchema: object(),
        result: () => ({ accounts: ["checking", "savings"] }),
      },
      {
        name: "list_card_activity",
        description: "Recent card payments, newest first.",
        inputSchema: object({ days: { type: "number", description: "How far back" } }),
        result: () => ({
          payments: [
            { merchant: BENCH_FIXTURE.cardMerchant, amount: 86.4, date: "2026-11-09" },
            { merchant: "Rewe", amount: 31.15, date: "2026-11-08" },
          ],
        }),
      },
      {
        name: "get_iban",
        description: "IBAN and routing details of an account.",
        inputSchema: object({ account: { type: "string", description: "checking or savings" } }),
        result: () => ({ iban: BENCH_FIXTURE.savingsIban }),
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
        inputSchema: object({ text: { type: "string", description: "Words to look for" } }),
        result: (a) => {
          const words = String(a.text ?? "")
            .toLowerCase()
            .split(/\W+/)
            .filter(Boolean);
          const hits = NOTES.filter((n) =>
            words.some((w) => `${n.title} ${n.text}`.toLowerCase().includes(w)),
          );
          return { notes: hits.length ? hits : NOTES };
        },
      },
      {
        name: "read_note",
        description: "Read one note by its id.",
        inputSchema: object({ id: { type: "string", description: "Note id" } }),
        result: (a) => ({ note: NOTES.find((n) => n.id === a.id) ?? null }),
      },
      {
        name: "list_notebooks",
        description: "List notebooks.",
        inputSchema: object(),
        result: () => ({ notebooks: ["Home", "Work", BENCH_FIXTURE.notebook] }),
      },
    ],
  },
  {
    name: "calendar",
    summary: "The owner's calendar: upcoming and past events.",
    tools: [
      {
        name: "next_event",
        description: "The next upcoming event.",
        inputSchema: object(),
        result: () => ({ title: BENCH_FIXTURE.nextEvent, date: "2026-11-18", time: "09:30" }),
      },
      {
        name: "list_events",
        description: "Events between two dates.",
        inputSchema: object({
          from: { type: "string", description: "Start date, YYYY-MM-DD" },
          to: { type: "string", description: "End date, YYYY-MM-DD" },
        }),
        result: () => ({
          events: [{ title: BENCH_FIXTURE.nextEvent, date: "2026-11-18", time: "09:30" }],
        }),
      },
    ],
  },
];

export const CORE_SERVER_COUNT = CORE.length;

interface Snapshot {
  name: string;
  summary: string;
  tools: McpToolDefinition[];
}

const SNAPSHOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "snapshots");

/** Ordered by filename, so the order is the same on every machine. */
function loadSnapshots(): Snapshot[] {
  let files: string[];
  try {
    files = readdirSync(SNAPSHOT_DIR)
      .filter((f) => f.endsWith(".json"))
      .sort();
  } catch {
    return [];
  }
  return files.map((f) => JSON.parse(readFileSync(join(SNAPSHOT_DIR, f), "utf8")) as Snapshot);
}

const SNAPSHOTS = loadSnapshots();

/** The largest scale the snapshots on disk allow. */
export const MAX_SCALE = CORE_SERVER_COUNT + SNAPSHOTS.length;

interface BenchServer {
  name: string;
  summary: string;
  tools: (McpToolDefinition & { result: (args: Args) => unknown })[];
}

// What a distractor answers if the model calls it: a valid, empty result.
const nothingFound = () => ({ results: [], message: "Nothing found." });

function serversAt(scale: number): BenchServer[] {
  if (scale < CORE_SERVER_COUNT || scale > MAX_SCALE) {
    throw new Error(
      `scale ${scale} is outside ${CORE_SERVER_COUNT}..${MAX_SCALE}: ` +
        `${SNAPSHOTS.length} snapshot(s) in eval/bench/snapshots.`,
    );
  }
  const distractors = SNAPSHOTS.slice(0, scale - CORE_SERVER_COUNT).map((s) => ({
    ...s,
    tools: s.tools.map((t) => ({ ...t, result: nothingFound })),
  }));
  return [...CORE, ...distractors];
}

/** The same runnable tool in both arms, with the schema exactly as the server listed it. */
function runnable(server: BenchServer, t: BenchServer["tools"][number]): StructuredToolInterface {
  return new DynamicStructuredTool({
    name: prefixedToolName(server.name, t.name),
    description: t.description ?? "",
    schema: (t.inputSchema ?? object()) as Record<string, unknown>,
    func: async (args: Args) => JSON.stringify(t.result(args ?? {})),
  });
}

export interface BenchWorld {
  scale: number;
  toolCount: number;
  /** Serialized definitions / 4, the catalog's own estimate. */
  schemaTokens: number;
  /** Every MCP tool name at this scale. */
  toolNames: Set<string>;
  /** Tools of the distractor servers: no task needs one. */
  distractorToolNames: Set<string>;
  /** Bind-all arm: every tool, given to the agent directly. */
  tools: StructuredToolInterface[];
  /** Disclosure arm. */
  servers: DisclosureServer[];
  resolveTool: ResolveMcpTool;
}

export function worldAt(scale: number): BenchWorld {
  const servers = serversAt(scale);
  const byName = new Map<string, StructuredToolInterface>();
  let schemaChars = 0;

  const disclosure: DisclosureServer[] = servers.map((s) => {
    const definitions = s.tools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
    for (const t of s.tools) byName.set(prefixedToolName(s.name, t.name), runnable(s, t));
    const chars = JSON.stringify(definitions).length;
    schemaChars += chars;
    return {
      id: `bench-${s.name}`,
      name: s.name,
      authRequired: false,
      catalog: {
        serverId: `bench-${s.name}`,
        toolsHash: "bench",
        tools: definitions,
        toolCount: definitions.length,
        schemaTokens: Math.round(chars / 4),
        summary: s.summary,
        summarySource: "heuristic",
        refreshedAt: new Date(0),
      },
    };
  });

  const resolveTool: ResolveMcpTool = async (_serverId, toolName) => {
    const tool = byName.get(toolName);
    if (!tool) return { ok: false, error: "connect_failed", message: "no such bench tool" };
    // .mts resolves @langchain/core's ESM types and the package its CJS ones: same class at runtime.
    return { ok: true, tool } as unknown as ToolResolution;
  };

  return {
    scale,
    toolCount: byName.size,
    schemaTokens: Math.round(schemaChars / 4),
    toolNames: new Set(byName.keys()),
    distractorToolNames: new Set(
      servers
        .slice(CORE_SERVER_COUNT)
        .flatMap((s) => s.tools.map((t) => prefixedToolName(s.name, t.name))),
    ),
    tools: [...byName.values()],
    servers: disclosure,
    resolveTool,
  };
}
