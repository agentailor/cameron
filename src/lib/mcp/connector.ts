import { MCPAdapter } from "@langchain/mcp-adapters";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { McpSession, ServerManifest } from "@agentailor/mcp-disclosure";
import { isAuthFailure } from "@/lib/mcp/authFailure";
import { ServerOAuthProvider } from "@/lib/mcp/oauth-provider";
import * as mcpServerRepo from "@/lib/repositories/mcpServerRepository";
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

  // The adapter's default `server_tool` names are the ones the model is shown: no renaming.
  const client = new MCPAdapter({
    servers: { [server.name]: config },
    onConnectionError: "throw",
    throwOnLoadError: true,
  });

  try {
    const loaded = await withTimeout(client.listTools());
    const sdk = await client.getClient(server.name);
    if (!sdk) throw new ConnectError("connect_failed", "Server did not connect.");

    const tools = new Map<string, StructuredToolInterface>(loaded.map((t) => [t.name, t]));
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
    if (server.type === "http" && isAuthFailure(error)) {
      // Record what the server said, so the Connections page offers Connect.
      const lost = server.oauthStatus === OAuthStatus.CONNECTED;
      await mcpServerRepo
        .setOAuthStatus(server.id, lost ? OAuthStatus.EXPIRED : OAuthStatus.REQUIRED)
        .catch(() => {});
      throw new ConnectError("auth_required", "This server needs sign-in: use Connect first.");
    }
    throw new ConnectError(
      "connect_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}
