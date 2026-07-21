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
  oauthStatus: string | null;
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

export interface MCPServerTools {
  tools: MCPTool[];
  count: number;
}

export interface MCPToolsGrouped {
  [serverName: string]: MCPServerTools;
}

export interface MCPToolsData {
  serverGroups: MCPToolsGrouped;
  totalCount: number;
}
