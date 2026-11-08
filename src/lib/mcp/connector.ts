import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { StructuredToolInterface } from "@langchain/core/tools";
import {
  TOOL_NAME_SEPARATOR,
  type McpSession,
  type ServerManifest,
} from "@agentailor/mcp-disclosure";
import { ServerOAuthProvider } from "@/lib/mcp/oauth-provider";
import { OAuthStatus } from "@/lib/mcp/oauth-status";
import { toServerConfig } from "@/lib/mcp/serverConfig";
import type { ServerToolsError } from "@/lib/agent/mcp";
import type { MCPServer } from "@/types/mcp";

/**
 * The ONE place the agent's MCP connections touch the client library. Everything above it — the
 * catalog refresh, the connection pool, the disclosure middleware — sees only {@link McpSession}.
 * Moving to another MCP client means rewriting this file.
 */

// Generous because a stdio server started with npx may have to download first.
export const CONNECT_TIMEOUT_MS = 60_000;

export class ConnectError extends Error {
  constructor(
    readonly code: ServerToolsError,
    message: string,
  ) {
    super(message);
  }
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new ConnectError("timeout", `No response within ${CONNECT_TIMEOUT_MS / 1000}s.`)),
        CONNECT_TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

/** The server cannot be used until the user (re)authorizes it — known without connecting. */
export function needsAuth(server: MCPServer): boolean {
  return (
    server.type === "http" &&
    (server.oauthStatus === OAuthStatus.REQUIRED || server.oauthStatus === OAuthStatus.EXPIRED)
  );
}

/** Connects to one server and lists its tools. Throws {@link ConnectError}. */
export async function openSession(server: MCPServer): Promise<McpSession> {
  if (needsAuth(server)) {
    throw new ConnectError("auth_required", "Connect this server with OAuth first.");
  }
  const config = toServerConfig(server, () => new ServerOAuthProvider(server.id, server.name));
  if (!config) {
    throw new ConnectError(
      "invalid_config",
      server.type === "stdio" ? "No command configured." : "No URL configured.",
    );
  }

  const client = new MultiServerMCPClient({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mcpServers: { [server.name]: config } as any,
    onConnectionError: "throw",
    throwOnLoadError: true,
    prefixToolNameWithServerName: true,
  });

  try {
    const loaded = await withTimeout(client.getTools());
    const sdk = await client.getClient(server.name);
    if (!sdk) throw new ConnectError("connect_failed", "Server did not connect.");

    const prefix = `${server.name}${TOOL_NAME_SEPARATOR}`;
    const tools = new Map<string, StructuredToolInterface>(
      loaded.map((t) => [t.name.startsWith(prefix) ? t.name.slice(prefix.length) : t.name, t]),
    );
    const closeListeners: (() => void)[] = [];
    const previousOnClose = sdk.onclose;
    sdk.onclose = () => {
      previousOnClose?.();
      for (const listener of closeListeners) listener();
    };

    return {
      async manifest(): Promise<ServerManifest> {
        const listed: ServerManifest["tools"] = [];
        let cursor: string | undefined;
        do {
          const page = await withTimeout(sdk.listTools(cursor ? { cursor } : {}));
          listed.push(...page.tools);
          cursor = page.nextCursor;
        } while (cursor);
        return { tools: listed, instructions: sdk.getInstructions() };
      },
      getTool: (name) => tools.get(name),
      close: () => client.close(),
      onClose: (listener) => void closeListeners.push(listener),
    };
  } catch (error) {
    await client.close().catch(() => {});
    if (error instanceof ConnectError) throw error;
    throw new ConnectError(
      "connect_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}
