import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { ServerOAuthProvider } from "@/lib/mcp/oauth-provider";
import { OAuthStatus } from "@/lib/mcp/oauth-status";
import { toServerConfig } from "@/lib/mcp/serverConfig";
import { CONNECT_TIMEOUT_MS } from "@/lib/mcp/connector";
import type { MCPServer, MCPTool } from "@/types/mcp";

const oauthProvider = (server: MCPServer) => new ServerOAuthProvider(server.id, server.name);

export type ServerToolsError = "auth_required" | "invalid_config" | "timeout" | "connect_failed";

export type ServerToolsResult =
  | { ok: true; tools: MCPTool[] }
  | { ok: false; error: ServerToolsError; message: string };

const PROBE_TIMEOUT_MS = CONNECT_TIMEOUT_MS;

class ProbeTimeout extends Error {}

/**
 * Connects to ONE server (enabled or not) and lists its tools, then closes the connection.
 * A failure is reported rather than skipped: with a single server, "no tools" and "could not
 * connect" must not look the same.
 */
export async function listServerTools(server: MCPServer): Promise<ServerToolsResult> {
  if (
    server.type === "http" &&
    (server.oauthStatus === OAuthStatus.REQUIRED || server.oauthStatus === OAuthStatus.EXPIRED)
  ) {
    return {
      ok: false,
      error: "auth_required",
      message: "Connect this server with OAuth before listing its tools.",
    };
  }

  const config = toServerConfig(server, oauthProvider);
  if (!config) {
    return {
      ok: false,
      error: "invalid_config",
      message: server.type === "stdio" ? "No command configured." : "No URL configured.",
    };
  }

  const client = new MultiServerMCPClient({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mcpServers: { [server.name]: config } as any,
    onConnectionError: "throw",
    throwOnLoadError: true,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const tools = await Promise.race([
      client.getTools(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ProbeTimeout()), PROBE_TIMEOUT_MS);
      }),
    ]);
    return {
      ok: true,
      tools: tools.map((tool) => ({ name: tool.name, description: tool.description || undefined })),
    };
  } catch (error) {
    if (error instanceof ProbeTimeout) {
      return {
        ok: false,
        error: "timeout",
        message: `No response within ${PROBE_TIMEOUT_MS / 1000}s.`,
      };
    }
    return {
      ok: false,
      error: "connect_failed",
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => {});
  }
}
