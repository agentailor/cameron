import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { MCPServer } from "@/types/mcp";
import { OAuthStatus } from "./oauth-status";

export interface StdioMCPServerConfig {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface HttpMCPServerConfig {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
  authProvider?: OAuthClientProvider;
}

export type MCPServerConfig = StdioMCPServerConfig | HttpMCPServerConfig;

/** True when the server has completed OAuth and its calls need the stored tokens. */
export function usesOAuth(server: MCPServer): boolean {
  return (
    server.type === "http" && !!server.requiresAuth && server.oauthStatus === OAuthStatus.CONNECTED
  );
}

/**
 * Turns a stored row into a MultiServerMCPClient connection config, or null when the row is
 * missing its command/url. Shared by the agent and the per-server tools probe so both connect
 * the same way. `authProvider` is injected to keep this module free of the database.
 */
export function toServerConfig(
  server: MCPServer,
  authProvider?: (server: MCPServer) => OAuthClientProvider,
): MCPServerConfig | null {
  if (server.type === "stdio" && server.command) {
    const config: StdioMCPServerConfig = { transport: "stdio", command: server.command };
    if (Array.isArray(server.args)) {
      config.args = server.args.filter((arg): arg is string => typeof arg === "string");
    }
    if (isRecord(server.env)) config.env = server.env as Record<string, string>;
    return config;
  }

  if (server.type === "http" && server.url) {
    const config: HttpMCPServerConfig = { transport: "http", url: server.url };
    if (isRecord(server.headers)) config.headers = server.headers as Record<string, string>;
    if (authProvider && usesOAuth(server)) config.authProvider = authProvider(server);
    return config;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
