import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import * as mcpServerRepo from "@/lib/repositories/mcpServerRepository";
import { ServerOAuthProvider } from "@/lib/mcp/oauth-provider";
import { OAuthStatus } from "@/lib/mcp/oauth-status";
import { toServerConfig, type MCPServerConfig } from "@/lib/mcp/serverConfig";
import type { MCPServer, MCPTool } from "@/types/mcp";
import { sanitizeTool } from "./util";

const oauthProvider = (server: MCPServer) => new ServerOAuthProvider(server.id, server.name);

/**
 * Fetches enabled MCP servers from the database and formats them for MultiServerMCPClient
 */
export async function getMCPServerConfigs(): Promise<Record<string, MCPServerConfig>> {
  try {
    const servers = await mcpServerRepo.listEnabled();

    const configs: Record<string, MCPServerConfig> = {};
    for (const server of servers) {
      const config = toServerConfig(server, oauthProvider);
      if (config) configs[server.name] = config;
    }

    return configs;
  } catch (error) {
    console.error("Failed to fetch MCP server configs:", error);
    return {};
  }
}

/**
 * Creates and initializes a MultiServerMCPClient with the current database configurations
 */
export async function createMCPClient(): Promise<MultiServerMCPClient | null> {
  try {
    const mcpServers = await getMCPServerConfigs();

    if (Object.keys(mcpServers).length === 0) {
      return null;
    }

    const client = new MultiServerMCPClient({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mcpServers: mcpServers as any, // Complex MCP server config types require type assertion
      throwOnLoadError: false, // Don't fail if some servers can't connect
      prefixToolNameWithServerName: true, // Prevent tool name conflicts
    });

    return client;
  } catch (error) {
    console.error("Failed to create MCP client:", error);
    return null;
  }
}

/**
 * Gets tools from the MCP client if available.
 * Sanitizes tool schemas to be compatible with Google Gemini's function calling API.
 */
export async function getMCPTools() {
  try {
    const client = await createMCPClient();
    if (!client) {
      return [];
    }

    const tools = await client.getTools();

    // Sanitize tool schemas to remove unsupported JSON Schema keywords
    // that would cause errors with Google Gemini
    const sanitizedTools = tools.map((tool) => sanitizeTool(tool));

    console.log(`Loaded ${sanitizedTools.length} tools from MCP servers`);
    return sanitizedTools;
  } catch (error) {
    console.error("Failed to get MCP tools:", error);
    return [];
  }
}

export type ServerToolsError = "auth_required" | "invalid_config" | "timeout" | "connect_failed";

export type ServerToolsResult =
  | { ok: true; tools: MCPTool[] }
  | { ok: false; error: ServerToolsError; message: string };

const PROBE_TIMEOUT_MS = 20_000;

class ProbeTimeout extends Error {}

/**
 * Connects to ONE server (enabled or not) and lists its tools, then closes the connection.
 * Unlike {@link getMCPTools}, a failure is reported rather than skipped: with a single server,
 * "no tools" and "could not connect" must not look the same.
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
