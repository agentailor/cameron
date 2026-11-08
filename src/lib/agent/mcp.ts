import { ConnectError, openSession } from "@/lib/mcp/connector";
import type { MCPServer, MCPTool } from "@/types/mcp";

export type ServerToolsError = "auth_required" | "invalid_config" | "timeout" | "connect_failed";

export type ServerToolsResult =
  | { ok: true; tools: MCPTool[] }
  | { ok: false; error: ServerToolsError; message: string };

/**
 * Connects to ONE server (enabled or not) and lists its tools, then closes the connection.
 * A failure is reported rather than skipped: with a single server, "no tools" and "could not
 * connect" must not look the same. Goes through the connector, so it connects as the agent does.
 */
export async function listServerTools(server: MCPServer): Promise<ServerToolsResult> {
  try {
    const session = await openSession(server);
    try {
      const { tools } = await session.manifest();
      return {
        ok: true,
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description || undefined,
        })),
      };
    } finally {
      await session.close().catch(() => {});
    }
  } catch (error) {
    if (error instanceof ConnectError) {
      return { ok: false, error: error.code, message: error.message };
    }
    return {
      ok: false,
      error: "connect_failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
