import { TOOL_NAME_SEPARATOR } from "./policy";
import type { DisclosureServer, McpToolDefinition } from "./types";

// Standard BM25 constants.
const K1 = 1.2;
const B = 0.75;

// Field weights, applied by repeating a field's tokens.
const WEIGHT = { name: 4, description: 2, argName: 2, argDescription: 1, server: 1 };

const STOP_WORDS = new Set(
  "a an and are as at be by for from i in is it me my of on or the to with".split(" "),
);

/** Splits on case and punctuation, so `API-post-search` and `postSearch` both match "search". */
export function tokenize(text: string): string[] {
  return (text.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2").match(/[\p{L}\p{N}]+/gu) ?? [])
    .map((t) => t.toLowerCase())
    .filter((t) => !STOP_WORDS.has(t))
    .map((t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));
}

/** Property names and descriptions anywhere in a schema, including `$defs` and `anyOf` branches. */
function collectSchemaText(schema: unknown, names: string[], descriptions: string[]): void {
  if (Array.isArray(schema)) {
    for (const item of schema) collectSchemaText(item, names, descriptions);
    return;
  }
  if (!schema || typeof schema !== "object") return;
  for (const [key, value] of Object.entries(schema)) {
    if (key === "description" && typeof value === "string") descriptions.push(value);
    if (key === "properties" && value && typeof value === "object") {
      names.push(...Object.keys(value));
      for (const child of Object.values(value)) collectSchemaText(child, names, descriptions);
    } else {
      collectSchemaText(value, names, descriptions);
    }
  }
}

export interface SearchableTool {
  /** `server__tool`, as the model calls it. */
  name: string;
  server: DisclosureServer;
  definition: McpToolDefinition;
}

interface Doc {
  tool: SearchableTool;
  freq: Map<string, number>;
  length: number;
}

function toDoc(tool: SearchableTool): Doc {
  const { definition, server } = tool;
  const argNames: string[] = [];
  const argDescriptions: string[] = [];
  collectSchemaText(definition.inputSchema, argNames, argDescriptions);
  const fields: [string, number, boolean][] = [
    [definition.name, WEIGHT.name, true],
    [definition.description ?? "", WEIGHT.description, true],
    [argNames.join(" "), WEIGHT.argName, false],
    [argDescriptions.join(" "), WEIGHT.argDescription, false],
    [server.name, WEIGHT.server, true],
  ];
  const freq = new Map<string, number>();
  let length = 0;
  for (const [text, weight, countsTowardLength] of fields) {
    for (const token of tokenize(text)) {
      freq.set(token, (freq.get(token) ?? 0) + weight);
      // A huge schema must not push down the tool it belongs to (Notion's create-page).
      if (countsTowardLength) length += weight;
    }
  }
  return { tool, freq, length };
}

export interface ToolSearchIndex {
  /** Every match, best first. The same query always gives the same order. */
  search(query: string, serverId?: string): SearchableTool[];
  tool(name: string): SearchableTool | undefined;
}

/** BM25 over the cached catalog: no connection, and built once per agent. */
export function createToolSearchIndex(servers: DisclosureServer[]): ToolSearchIndex {
  const tools: SearchableTool[] = servers.flatMap((server) =>
    (server.catalog?.tools ?? []).map((definition) => ({
      name: `${server.name}${TOOL_NAME_SEPARATOR}${definition.name}`,
      server,
      definition,
    })),
  );
  const byName = new Map(tools.map((t) => [t.name, t]));
  const docs = tools.map(toDoc);
  const docFreq = new Map<string, number>();
  for (const doc of docs) {
    for (const token of doc.freq.keys()) docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
  }
  const averageLength = docs.reduce((sum, d) => sum + d.length, 0) / (docs.length || 1);

  return {
    tool: (name) => byName.get(name),
    search(query, serverId) {
      const terms = [...new Set(tokenize(query))];
      return docs
        .filter((doc) => !serverId || doc.tool.server.id === serverId)
        .map((doc) => {
          let score = 0;
          for (const term of terms) {
            const tf = doc.freq.get(term);
            if (!tf) continue;
            const n = docFreq.get(term)!;
            const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
            score += (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.length) / averageLength));
          }
          return { tool: doc.tool, score };
        })
        .filter((hit) => hit.score > 0)
        .sort(
          (a, b) =>
            b.score - a.score ||
            (a.tool.name < b.tool.name ? -1 : a.tool.name > b.tool.name ? 1 : 0),
        )
        .map((hit) => hit.tool);
    },
  };
}
