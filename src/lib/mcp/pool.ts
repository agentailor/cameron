import {
  McpConnectionPool,
  hashTools,
  normalizeTools,
  type ResolveMcpTool,
  type ServerCatalogEntry,
} from "@agentailor/mcp-disclosure";
import { ConnectError, openSession } from "@/lib/mcp/connector";
import { refreshFromManifest } from "@/lib/mcp/catalog";
import type { MCPServer } from "@/types/mcp";

// On globalThis so dev hot reload reuses the pool instead of leaking connections (and processes).
const globalForPool = globalThis as typeof globalThis & { __mcpPool?: McpConnectionPool };
export const mcpPool = (globalForPool.__mcpPool ??= new McpConnectionPool());

/**
 * The middleware's `resolveTool` for one agent build. A server's `updatedAt` is its connection
 * version: any edit (or token write) bumps it, so the next call reconnects instead of reusing a
 * session opened with stale settings.
 */
export function createToolResolver(
  servers: MCPServer[],
  catalogs: Map<string, ServerCatalogEntry>,
): ResolveMcpTool {
  const byId = new Map(servers.map((s) => [s.id, s]));
  return async (serverId, toolName) => {
    const server = byId.get(serverId);
    if (!server) return { ok: false, error: "not_found", message: "Server is not enabled." };
    try {
      const session = await mcpPool.session(serverId, server.updatedAt.toISOString(), async () => {
        console.log(`[mcp-disclosure] connecting to ${server.name}`);
        const opened = await openSession(server);
        void checkFreshness(server, opened, catalogs.get(serverId));
        return opened;
      });
      const tool = session.getTool(toolName);
      if (!tool) {
        return {
          ok: false,
          error: "unknown_tool",
          message: `The server no longer has "${toolName}".`,
        };
      }
      return { ok: true, tool };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof ConnectError ? error.code : "connect_failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

/** If the live tool list no longer matches the catalog, rewrite the row from this connection. */
async function checkFreshness(
  server: MCPServer,
  session: Awaited<ReturnType<typeof openSession>>,
  cached: ServerCatalogEntry | undefined,
): Promise<void> {
  try {
    const manifest = await session.manifest();
    if (cached && hashTools(normalizeTools(manifest.tools)) === cached.toolsHash) return;
    console.log(`[mcp-disclosure] ${server.name}: catalog is stale, refreshing`);
    await refreshFromManifest(server, manifest);
  } catch (error) {
    console.warn(`[mcp-disclosure] freshness check failed for ${server.name}:`, error);
  }
}
