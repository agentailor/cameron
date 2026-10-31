import type { StructuredToolInterface } from "@langchain/core/tools";

/** One tool as an MCP server lists it (`tools/list`), before any LangChain conversion. */
export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: unknown;
}

/** What a catalog refresh reads from a live server. */
export interface ServerManifest {
  tools: McpToolDefinition[];
  /** The `instructions` string from the server's initialize result, if it sent one. */
  instructions?: string;
}

export type SummarySource = "instructions" | "heuristic" | "generated";

/** The cached "server card": enough to describe a server without connecting to it. */
export interface ServerCatalogEntry {
  serverId: string;
  toolsHash: string;
  tools: McpToolDefinition[];
  toolCount: number;
  /** Rough size of the tool schemas a model would be sent: serialized JSON length / 4. */
  schemaTokens: number;
  summary: string;
  summarySource: SummarySource;
  refreshedAt: Date;
}

/** An enabled server as the middleware sees it. `catalog: null` means unavailable this request. */
export interface DisclosureServer {
  id: string;
  /** Unique; also the prefix of the server's tool names (`name__tool`). */
  name: string;
  /**
   * The server needs the user to (re)authorize it before it can be used — known from stored
   * state, without connecting. `load_tools` never loads its tools.
   */
  authRequired: boolean;
  /** Written by the owner; shown instead of the catalog's summary when set. */
  description?: string | null;
  catalog: ServerCatalogEntry | null;
}

export interface DisclosureOptions {
  /** A call to a catalog tool that was not loaded runs and loads it, instead of failing. */
  autoLoadOnCall: boolean;
}

export const DEFAULT_DISCLOSURE_OPTIONS: DisclosureOptions = {
  autoLoadOnCall: true,
};

/**
 * One open connection to one MCP server. Implemented by the host app over whichever MCP client
 * library it uses, so this package depends only on MCP protocol shapes and LangChain tools.
 */
export interface McpSession {
  /** `tools/list` plus the server's `instructions`, read live. */
  manifest(): Promise<ServerManifest>;
  /** A runnable tool by its MCP name (unprefixed), or undefined if the server has no such tool. */
  getTool(name: string): StructuredToolInterface | undefined;
  close(): Promise<void>;
  /** Called when the connection drops on its own (a stdio process exits, a stream closes). */
  onClose?(listener: () => void): void;
}

export type ToolResolution =
  | { ok: true; tool: StructuredToolInterface }
  | { ok: false; error: string; message: string };

/** Finds the runnable tool for a call, connecting to its server if needed. Never throws. */
export type ResolveMcpTool = (serverId: string, toolName: string) => Promise<ToolResolution>;
