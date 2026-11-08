import type { DisclosureServer } from "./types";

/** The `{server}_{tool}` form `@langchain/mcp-adapters` 2.x gives tools by default. */
export const TOOL_NAME_SEPARATOR = "_";

/** The name the model sees for a server's tool; also the adapter's own name for it. */
export function prefixedToolName(serverName: string, toolName: string): string {
  return `${serverName}${TOOL_NAME_SEPARATOR}${toolName}`;
}

/** Servers the model can be told about: a server with no catalog row is unavailable. */
export function catalogedServers(servers: DisclosureServer[]): DisclosureServer[] {
  return servers.filter((s) => s.catalog !== null);
}

const byName = (a: DisclosureServer, b: DisclosureServer) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

export const CATALOG_HEADER =
  "Additional capabilities are available. Call load_tools with a short description of what you " +
  "need before using them.";

/** Null with nothing to offer. Byte-stable across turns: sorted, and no per-turn state in it. */
export function renderCatalogBlock(servers: DisclosureServer[]): string | null {
  const available = catalogedServers(servers);
  if (available.length === 0) return null;
  const lines = available.sort(byName).map((s) => {
    const auth = s.authRequired ? " (sign-in required)" : "";
    return `- ${s.name}${auth}: ${s.description || s.catalog!.summary}`;
  });
  return [CATALOG_HEADER, ...lines].join("\n");
}

/**
 * Maps a tool name (`server_tool`) back to its server. Names may contain `_`, so a prefix can
 * fit several servers: the one whose catalog lists the rest wins, else the longest name. Returns
 * null for a tool that is not an MCP tool.
 */
export function createToolServerIndex(servers: DisclosureServer[]) {
  const ordered = [...servers].sort((a, b) => b.name.length - a.name.length);
  return (toolName: string): DisclosureServer | null => {
    const candidates = ordered.filter((s) => toolName.startsWith(prefixedToolName(s.name, "")));
    const listing = candidates.find((s) => {
      const rest = toolName.slice(s.name.length + TOOL_NAME_SEPARATOR.length);
      return s.catalog?.tools.some((t) => t.name === rest);
    });
    return listing ?? candidates[0] ?? null;
  };
}

/** Resolves a server the model named: the catalog name, or the id. */
export function findServer(servers: DisclosureServer[], ref: string): DisclosureServer | undefined {
  const key = ref.trim();
  return servers.find((s) => s.name === key) ?? servers.find((s) => s.id === key);
}
