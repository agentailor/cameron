import type { MCPServer, MCPServerType } from "@/types/mcp";
import { toPublicOAuthClient, type PublicOAuthClient } from "./oauthClient";

/**
 * An MCP server as the API returns it to the browser. Built field by field, so a column added to
 * {@link MCPServer} stays server-side until it is listed here. Tokens, client registrations, the
 * PKCE verifier, the sign-in state and the client secret are never listed.
 *
 * `env` and `headers` are included: the form edits them, and they are the owner's own values.
 */
export interface PublicMCPServer {
  id: string;
  name: string;
  description: string | null;
  type: MCPServerType;
  enabled: boolean;
  command: string | null;
  args: unknown;
  env: unknown;
  url: string | null;
  headers: unknown;
  requiresAuth: boolean | null;
  oauthStatus: string | null;
  oauthClient: PublicOAuthClient | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toPublicServer(server: MCPServer): PublicMCPServer {
  return {
    id: server.id,
    name: server.name,
    description: server.description,
    type: server.type,
    enabled: server.enabled,
    command: server.command,
    args: server.args,
    env: server.env,
    url: server.url,
    headers: server.headers,
    requiresAuth: server.requiresAuth,
    oauthStatus: server.oauthStatus,
    oauthClient: toPublicOAuthClient(server.oauthClient),
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
  };
}
