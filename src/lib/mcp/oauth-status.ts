/**
 * OAuth status constants for MCP servers.
 *
 * Kept in its own dependency-free module so it can be imported by BOTH client
 * components (e.g. MCPServerList) and server code without dragging in the
 * database layer. Do not add server-only imports here.
 */
export const OAuthStatus = {
  UNKNOWN: "UNKNOWN",
  NOT_REQUIRED: "NOT_REQUIRED",
  REQUIRED: "REQUIRED",
  CONNECTED: "CONNECTED",
  EXPIRED: "EXPIRED",
} as const;

export type OAuthStatus = (typeof OAuthStatus)[keyof typeof OAuthStatus];
