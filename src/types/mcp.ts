import type { PreregisteredClient } from "@/lib/mcp/oauthClient";

export enum MCPServerType {
  stdio = "stdio",
  http = "http",
}

/**
 * Domain representation of an MCP server row. Returned by the repository layer so
 * callers never depend on the underlying ORM's inferred row types. JSON columns are
 * exposed as `unknown` and narrowed by consumers (matches how the old records were used).
 */
export interface MCPServer {
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
  authTokens: unknown;
  clientInfo: unknown;
  codeVerifier: string | null;
  oauthState: string | null;
  oauthStatus: string | null;
  /** Server-only: holds the client secret. Browsers get {@link toPublicServer} instead. */
  oauthClient: PreregisteredClient | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Domain representation of a Thread row (see {@link MCPServer} for the rationale). */
export interface ThreadRecord {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MCPTool {
  name: string;
  description?: string;
}
