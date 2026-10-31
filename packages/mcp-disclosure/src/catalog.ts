import { createHash } from "node:crypto";
import type { McpToolDefinition, ServerCatalogEntry, ServerManifest, SummarySource } from "./types";

const SUMMARY_MAX_CHARS = 160;
const HEURISTIC_TOOL_NAMES = 4;

/** Sorted by name, with only the fields that change what a model sees. */
export function normalizeTools(tools: McpToolDefinition[]): McpToolDefinition[] {
  return [...tools]
    .filter((t) => !!t.name)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema ?? {},
      ...(t.annotations !== undefined ? { annotations: t.annotations } : {}),
    }));
}

/** JSON with object keys sorted, so the hash ignores key order. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function hashTools(normalized: McpToolDefinition[]): string {
  return createHash("sha256").update(stableStringify(normalized)).digest("hex");
}

export function estimateSchemaTokens(normalized: McpToolDefinition[]): number {
  return Math.ceil(JSON.stringify(normalized).length / 4);
}

/** Collapses whitespace and cuts at a word boundary. */
export function truncate(text: string, max = SUMMARY_MAX_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

/** First sentence (or line) of the server's instructions, skipping markdown headings. */
export function summaryFromInstructions(instructions: string): string | null {
  const firstLine = instructions
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .map((l) => l.replace(/^[>*\-\s]+/, "").trim())
    .find((l) => l.length > 0);
  if (!firstLine) return null;
  const sentence = firstLine.match(/^(.+?[.!?])(\s|$)/)?.[1] ?? firstLine;
  return truncate(sentence);
}

export function heuristicSummary(serverName: string, tools: McpToolDefinition[]): string {
  if (tools.length === 0) return `${serverName}: no tools listed`;
  const names = tools.slice(0, HEURISTIC_TOOL_NAMES).map((t) => t.name);
  const more = tools.length - names.length;
  return truncate(`Tools: ${names.join(", ")}${more > 0 ? ` and ${more} more` : ""}`);
}

/** Optional LLM summarizer. Called only when the tool list changed (or no summary exists). */
export type ServerSummarizer = (input: {
  serverName: string;
  manifest: ServerManifest;
}) => Promise<string>;

export interface CatalogRefreshDeps {
  fetchManifest: () => Promise<ServerManifest>;
  readEntry: () => Promise<ServerCatalogEntry | null>;
  writeEntry: (entry: ServerCatalogEntry) => Promise<void>;
  summarize?: ServerSummarizer;
  now?: () => Date;
}

/**
 * Connects (via `fetchManifest`), hashes the tool list and upserts the catalog entry. Throws on a
 * connection failure and leaves the stored entry untouched — the caller decides how to log it.
 */
export async function refreshServerCatalog(
  server: { id: string; name: string },
  deps: CatalogRefreshDeps,
): Promise<ServerCatalogEntry> {
  const manifest = await deps.fetchManifest();
  const previous = await deps.readEntry();
  const tools = normalizeTools(manifest.tools);
  const toolsHash = hashTools(tools);
  const unchanged = previous?.toolsHash === toolsHash;

  let summary: string | null = null;
  let summarySource: SummarySource = "heuristic";
  if (deps.summarize) {
    if (unchanged && previous.summarySource === "generated") {
      summary = previous.summary;
    } else {
      try {
        summary = truncate(await deps.summarize({ serverName: server.name, manifest }));
      } catch (error) {
        console.warn(`[mcp-disclosure] summary generation failed for ${server.name}:`, error);
      }
    }
    if (summary) summarySource = "generated";
  }
  if (!summary && manifest.instructions) {
    summary = summaryFromInstructions(manifest.instructions);
    if (summary) summarySource = "instructions";
  }
  if (!summary) {
    summary = heuristicSummary(server.name, tools);
    summarySource = "heuristic";
  }

  const entry: ServerCatalogEntry = {
    serverId: server.id,
    toolsHash,
    tools: unchanged ? previous.tools : tools,
    toolCount: tools.length,
    schemaTokens: unchanged ? previous.schemaTokens : estimateSchemaTokens(tools),
    summary,
    summarySource,
    refreshedAt: (deps.now ?? (() => new Date()))(),
  };
  await deps.writeEntry(entry);
  return entry;
}
