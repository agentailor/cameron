import { prefixedToolName } from "@agentailor/mcp-disclosure";
import * as mcpServerRepo from "@/lib/repositories/mcpServerRepository";
import * as catalogRepo from "@/lib/repositories/mcpServerCatalogRepository";

/** An MCP tool as the stored catalog lists it. Reading the catalog never connects. */
export interface ServerTool {
  /** The name the agent calls it by: `server_tool`. */
  tool: string;
  /** The tool's own name on its server. */
  name: string;
  /** The server's `readOnlyHint`: a claim, not a guarantee. null when it says nothing. */
  readOnly: boolean | null;
}

export interface ServerTools {
  server: string;
  serverId: string;
  tools: ServerTool[];
}

/** Every enabled server with a catalog, and its tools, sorted by server name. */
export async function listServerTools(): Promise<ServerTools[]> {
  const servers = await mcpServerRepo.listEnabled();
  const catalogs = new Map(
    (await catalogRepo.listByServerIds(servers.map((s) => s.id))).map((c) => [c.serverId, c]),
  );
  return servers
    .filter((s) => catalogs.has(s.id))
    .map((s) => ({
      server: s.name,
      serverId: s.id,
      tools: catalogs.get(s.id)!.tools.map((t) => {
        const hint = (t.annotations as { readOnlyHint?: unknown } | undefined)?.readOnlyHint;
        return {
          tool: prefixedToolName(s.name, t.name),
          name: t.name,
          readOnly: typeof hint === "boolean" ? hint : null,
        };
      }),
    }))
    .sort((a, b) => a.server.localeCompare(b.server));
}
