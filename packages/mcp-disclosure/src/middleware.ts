import { createMiddleware, tool, type ToolRuntime } from "langchain";
import { ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { Command, ReducedValue, StateSchema, isCommand } from "@langchain/langgraph";
import { z } from "zod";
import { truncate } from "./catalog";
import { catalogTools, standInTool } from "./catalogTools";
import {
  catalogedServers,
  createToolServerIndex,
  findServer,
  prefixedToolName,
  renderCatalogBlock,
  TOOL_NAME_SEPARATOR,
} from "./policy";
import { createToolSearchIndex, type SearchableTool, type ToolSearchIndex } from "./search";
import {
  DEFAULT_DISCLOSURE_OPTIONS,
  type DisclosureOptions,
  type DisclosureServer,
  type ResolveMcpTool,
  type SavedToolDefinition,
} from "./types";

export const LOAD_TOOLS_TOOL = "load_tools";
export const DEFAULT_LOAD_LIMIT = 5;
export const MAX_LOAD_LIMIT = 10;
const NO_MATCH_NAMES_PER_SERVER = 30;

/** Appends, keeping first-load order: the `tools` array must only ever grow at its end. */
function appendNew(current: string[], next: string[]): string[] {
  return [...new Set([...current, ...next])];
}

type SavedDefinitions = Record<string, SavedToolDefinition>;

/** The first definition saved for a name wins: what the model is shown never changes. */
function keepFirst(current: SavedDefinitions, next: SavedDefinitions): SavedDefinitions {
  return { ...next, ...current };
}

const savedDefinitionsSchema = z
  .record(
    z.string(),
    z.object({
      server: z.string(),
      tool: z.object({
        name: z.string(),
        description: z.string().optional(),
        inputSchema: z.unknown().optional(),
        annotations: z.unknown().optional(),
      }),
    }),
  )
  .default(() => ({}));

/** Persisted per thread by the checkpointer. Reducers, so two loads in one step both apply. */
export const disclosureStateSchema = new StateSchema({
  /** `server_tool` names available to the model, in the order they were loaded. */
  activeTools: new ReducedValue(
    z.array(z.string()).default(() => []),
    { inputSchema: z.array(z.string()).default(() => []), reducer: appendNew },
  ),
  /**
   * Each loaded tool's definition, saved when it was loaded, so the tool stays in the list after
   * its server is removed or turned off. Threads from before this field hold names only.
   */
  toolDefinitions: new ReducedValue(savedDefinitionsSchema, {
    inputSchema: savedDefinitionsSchema,
    reducer: keepFirst,
  }),
});

type DisclosureState = { activeTools?: string[]; toolDefinitions?: SavedDefinitions };

const saved = (hit: SearchableTool): SavedToolDefinition => ({
  server: hit.server.name,
  tool: hit.definition,
});

export interface DisclosureMiddlewareConfig {
  /** Every enabled server, with its catalog entry (`null` = unavailable for this request). */
  servers: DisclosureServer[];
  /** Supplies the real tool when one is called — typically from a {@link McpConnectionPool}. */
  resolveTool: ResolveMcpTool;
  options?: Partial<DisclosureOptions>;
  log?: (line: string) => void;
}

const json = (value: unknown) => JSON.stringify(value);

const reconnectMessage = (server: DisclosureServer) =>
  `${server.name} needs to be reconnected before its tools can be used. Ask the user to ` +
  `reconnect it on the Connections page, then try again.`;

/** What the model is told when a server needs the user before it can be used. */
const authRequired = (server: DisclosureServer) => ({
  ok: false,
  error: "auth_required",
  server: server.name,
  message: reconnectMessage(server),
});

type LoadToolsArgs = { query?: unknown; server?: unknown; limit?: unknown };

const asLimit = (limit: unknown) =>
  typeof limit === "number" && limit >= 1
    ? Math.min(Math.floor(limit), MAX_LOAD_LIMIT)
    : DEFAULT_LOAD_LIMIT;

/** A catalog name, prefixed or not, is an exact request for that one tool. */
function exactMatch(
  query: string,
  index: ToolSearchIndex,
  scope: DisclosureServer[],
): SearchableTool | undefined {
  const name = query.trim();
  const direct = index.tool(name);
  if (direct && scope.some((s) => s.id === direct.server.id)) return direct;
  return scope.map((s) => index.tool(prefixedToolName(s.name, name))).find(Boolean);
}

/**
 * What a load_tools call returns and which tools it adds. Pure, so the tool (which returns the
 * payload) and wrapToolCall (which applies the change) cannot disagree. The tool itself returns a
 * plain string: the chat UI streams a tool's raw return value, so a Command returned from the tool
 * would reach it as a serialized object.
 */
export function planLoadTools(
  args: LoadToolsArgs,
  servers: DisclosureServer[],
  index: ToolSearchIndex,
  state: DisclosureState,
): { payload: Record<string, unknown>; add: string[]; definitions: SavedDefinitions } {
  const available = catalogedServers(servers);
  const query = typeof args.query === "string" ? args.query : "";
  const ref = typeof args.server === "string" ? args.server.trim() : "";

  const scoped = ref ? findServer(available, ref) : undefined;
  if (ref && !scoped) {
    return {
      payload: {
        ok: false,
        error: "unknown_server",
        message: `No capability named "${ref}".`,
        availableServers: available.map((s) => s.name).sort(),
      },
      add: [],
      definitions: {},
    };
  }
  if (scoped?.authRequired) return { payload: authRequired(scoped), add: [], definitions: {} };

  const exact = exactMatch(query, index, scoped ? [scoped] : available);
  const hits = exact ? [exact] : index.search(query, scoped?.id);

  if (hits.length === 0) {
    const scope = (scoped ? [scoped] : available).filter((s) => !s.authRequired);
    return {
      payload: {
        ok: true,
        loaded: [],
        matched: 0,
        hint: "Nothing matched. Search again with other words, or with a tool name from toolNames.",
        toolNames: Object.fromEntries(
          scope.map((s) => [
            s.name,
            s.catalog!.tools.slice(0, NO_MATCH_NAMES_PER_SERVER).map((t) => t.name),
          ]),
        ),
      },
      add: [],
      definitions: {},
    };
  }

  const usable = hits.filter((h) => !h.server.authRequired);
  const blocked = [...new Set(hits.filter((h) => h.server.authRequired).map((h) => h.server))];
  if (usable.length === 0) {
    return { payload: authRequired(blocked[0]), add: [], definitions: {} };
  }

  const active = new Set(state.activeTools ?? []);
  const top = usable.slice(0, asLimit(args.limit));
  const fresh = top.filter((h) => !active.has(h.name));
  return {
    payload: {
      ok: true,
      loaded: fresh.map((h) => ({
        name: h.name,
        description: truncate(h.definition.description ?? ""),
      })),
      alreadyLoaded: top.filter((h) => active.has(h.name)).map((h) => h.name),
      matched: usable.length,
      ...(blocked.length > 0
        ? { signInRequired: blocked.map((s) => ({ server: s.name, message: reconnectMessage(s) })) }
        : {}),
    },
    add: fresh.map((h) => h.name),
    // Also back-fills a tool loaded before definitions were saved.
    definitions: Object.fromEntries(
      top.filter((h) => !state.toolDefinitions?.[h.name]).map((h) => [h.name, saved(h)]),
    ),
  };
}

const loadToolsSchema = z.object({
  query: z
    .string()
    .describe("What you need to do, in a few words, or an exact tool name to load only that tool"),
  server: z.string().optional().describe("Search only this capability, named as the list shows"),
  limit: z
    .number()
    .optional()
    .describe(`How many tools to load. Default ${DEFAULT_LOAD_LIMIT}, at most ${MAX_LOAD_LIMIT}`),
});

function buildLoadToolsTool(servers: DisclosureServer[], index: ToolSearchIndex) {
  return tool(
    async (args: z.infer<typeof loadToolsSchema>, runtime: ToolRuntime<DisclosureState>) =>
      json(planLoadTools(args, servers, index, runtime.state ?? {}).payload),
    {
      name: LOAD_TOOLS_TOOL,
      description:
        "Find tools for one of the listed capabilities and make the best matches callable from " +
        "the next step on. Returns the names of the tools loaded and how many matched. If the " +
        "right tool is missing, search again with other words. Changes nothing outside this " +
        "conversation.",
      schema: loadToolsSchema,
    },
  );
}

type ToolCallLike = { toolCall: { id?: string; name: string } };

/**
 * What the model is told when a loaded tool's server was removed or turned off. A thread from
 * before definitions were saved knows only the tool's name, not its server's.
 */
const serverUnavailable = (server: string | undefined, tool: string) => ({
  ok: false,
  error: "server_unavailable",
  ...(server ? { server } : { tool }),
  message:
    `${server ?? `The server behind ${tool}`} is no longer available: it was removed or ` +
    `turned off. Ask the user to add it back or turn it on in the Connections page, then try ` +
    `again.`,
});

const errorMessage = (request: ToolCallLike, body: object) =>
  new ToolMessage({
    content: json(body),
    tool_call_id: request.toolCall.id ?? "",
    name: request.toolCall.name,
    status: "error",
  });

/**
 * Tool-level progressive disclosure. The model sees a short list of capabilities plus
 * `load_tools`, and a tool's definition only once a search has loaded it in the thread.
 *
 * No MCP tool is registered with the agent and nothing connects up front: loaded tools are
 * stand-ins built from the cached catalog, and a call runs on the real tool from `resolveTool`,
 * which connects to that one server on demand. Loaded tools are never removed, because changing
 * the tool list costs a prompt-cache miss: their definitions are saved in the thread, so they
 * outlive their server, and a call to one whose server is gone returns `server_unavailable`.
 */
export function mcpServerDisclosureMiddleware(config: DisclosureMiddlewareConfig) {
  const options: DisclosureOptions = { ...DEFAULT_DISCLOSURE_OPTIONS, ...config.options };
  const servers = config.servers;
  const log = config.log ?? ((line: string) => console.log(line));
  const serverOf = createToolServerIndex(servers);
  const index = createToolSearchIndex(servers);
  const standIns = new Map(
    [...catalogTools(servers).values()]
      .flat()
      .map((t): [string, StructuredToolInterface] => [t.name, t]),
  );
  const totalTools = standIns.size;
  // Keyed by name and definition: a thread that saved an older schema keeps that one.
  const savedStandIns = new Map<string, StructuredToolInterface>();
  const standInFor = (name: string, definition: SavedToolDefinition) => {
    const key = `${name}\u0000${JSON.stringify(definition.tool)}`;
    let tool = savedStandIns.get(key);
    if (!tool) savedStandIns.set(key, (tool = standInTool(name, definition.tool)));
    return tool;
  };
  const catalogBlock = renderCatalogBlock(servers);

  /** Runs an MCP tool call on the real tool, connecting to its server if needed. */
  const runMcpTool = async <R extends ToolCallLike>(
    request: R,
    handler: (
      request: R & { tool: StructuredToolInterface },
    ) => ToolMessage | Command | Promise<ToolMessage | Command>,
    server: DisclosureServer,
  ): Promise<ToolMessage | Command> => {
    const name = request.toolCall.name.slice(server.name.length + TOOL_NAME_SEPARATOR.length);
    // With no catalog this request, the live server decides whether the tool exists.
    if (server.catalog && !server.catalog.tools.some((t) => t.name === name)) {
      return errorMessage(request, {
        ok: false,
        error: "unknown_tool",
        message: `${server.name} has no tool named "${name}".`,
      });
    }
    const resolved = await config.resolveTool(server.id, request.toolCall.name);
    if (!resolved.ok) {
      log(`[mcp-disclosure] ${server.name}: ${resolved.error} — ${resolved.message}`);
      // A token can expire after the tool was loaded; same instruction as load_tools gives.
      if (resolved.error === "auth_required") return errorMessage(request, authRequired(server));
      return errorMessage(request, {
        ok: false,
        error: resolved.error,
        message: `Could not reach ${server.name}: ${resolved.message}`,
      });
    }
    try {
      return await handler({ ...request, tool: resolved.tool });
    } finally {
      resolved.release?.();
    }
  };

  return createMiddleware({
    name: "McpServerDisclosure",
    stateSchema: disclosureStateSchema,
    // With nothing to offer, neither the tool nor the capability list reaches the model.
    tools: catalogBlock ? [buildLoadToolsTool(servers, index)] : [],

    wrapModelCall: (request, handler) => {
      // From the thread's saved definition, so removing a server doesn't shrink the list. A
      // thread from before definitions were saved falls back to the catalog.
      const definitions = request.state.toolDefinitions ?? {};
      const loaded = (request.state.activeTools ?? []).flatMap((name) => {
        const definition = definitions[name];
        return definition ? [standInFor(name, definition)] : (standIns.get(name) ?? []);
      });
      log(
        `[mcp-disclosure] loaded=${loaded.length}/${totalTools} ` +
          `tools=${request.tools.length + loaded.length}`,
      );
      if (!catalogBlock && loaded.length === 0) return handler(request);
      return handler({
        ...request,
        tools: [...request.tools, ...loaded],
        ...(catalogBlock
          ? { systemMessage: request.systemMessage.concat(`\n\n${catalogBlock}`) }
          : {}),
      });
    },

    wrapToolCall: async (request, handler) => {
      const name = request.toolCall.name;
      if (name === LOAD_TOOLS_TOOL) {
        const result = await handler(request);
        const { add, definitions } = planLoadTools(
          request.toolCall.args,
          servers,
          index,
          request.state,
        );
        if ((add.length === 0 && Object.keys(definitions).length === 0) || isCommand(result)) {
          return result;
        }
        return new Command({
          update: { activeTools: add, toolDefinitions: definitions, messages: [result] },
        });
      }

      const server = serverOf(name);
      if (!server) {
        // A loaded tool whose server is gone: say so, rather than fall through to "unknown tool".
        const definition = request.state.toolDefinitions?.[name];
        if (definition || (request.state.activeTools ?? []).includes(name)) {
          return errorMessage(request, serverUnavailable(definition?.server, name));
        }
        return handler(request);
      }

      const loaded = (request.state.activeTools ?? []).includes(name);
      if (!loaded && !options.autoLoadOnCall) {
        return errorMessage(request, {
          ok: false,
          error: "tool_not_loaded",
          message: `Call ${LOAD_TOOLS_TOOL} with query "${name}" before using this tool.`,
        });
      }

      const result = await runMcpTool(request, handler, server);
      if (loaded || isCommand(result) || result.status === "error") return result;
      log(`[mcp-disclosure] auto-loaded ${name} on call`);
      const hit = index.tool(name);
      return new Command({
        update: {
          activeTools: [name],
          toolDefinitions: hit ? { [name]: saved(hit) } : {},
          messages: [result],
        },
      });
    },
  });
}
