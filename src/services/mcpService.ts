import type { MCPTool } from "@/types/mcp";
import { toRequestBody, type ServerInput, type ServerTransport } from "@/lib/mcp/configParse";

/** An MCP server as `GET /api/mcp-servers` returns it (dates are ISO strings on the wire). */
export interface MCPServerView {
  id: string;
  name: string;
  type: ServerTransport;
  enabled: boolean;
  command: string | null;
  args: unknown;
  env: unknown;
  url: string | null;
  headers: unknown;
  requiresAuth: boolean | null;
  oauthStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ServerToolsErrorCode =
  | "not_found"
  | "auth_required"
  | "invalid_config"
  | "timeout"
  | "connect_failed";

/** A failed tools probe, kept typed so the UI can explain it rather than show a bare error. */
export class ServerToolsError extends Error {
  constructor(
    readonly code: ServerToolsErrorCode,
    message: string,
  ) {
    super(message);
  }
}

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const fetchServers = () => send<MCPServerView[]>("/api/mcp-servers");

export const createServer = (input: ServerInput) =>
  send<MCPServerView>("/api/mcp-servers", json("POST", toRequestBody(input)));

export const updateServer = (id: string, input: ServerInput) =>
  send<MCPServerView>("/api/mcp-servers", json("PATCH", { id, ...toRequestBody(input) }));

export const setServerEnabled = (id: string, enabled: boolean) =>
  send<MCPServerView>("/api/mcp-servers", json("PATCH", { id, enabled }));

export const deleteServer = (id: string) =>
  send<{ success: boolean }>(`/api/mcp-servers?id=${encodeURIComponent(id)}`, { method: "DELETE" });

export async function fetchServerTools(id: string): Promise<MCPTool[]> {
  const response = await fetch(`/api/mcp-servers/${encodeURIComponent(id)}/tools`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ServerToolsError(
      body.error ?? "connect_failed",
      body.message ?? `Request failed (${response.status})`,
    );
  }
  return body.tools;
}

export interface OAuthCheck {
  connected: boolean;
  authorizationUrl?: string;
  error?: string;
}

export const checkOAuth = (id: string) =>
  fetch(`/api/oauth/check/${encodeURIComponent(id)}`).then((r) => r.json() as Promise<OAuthCheck>);

/** The stored row as an editable definition. */
export function inputFromServer(server: MCPServerView): ServerInput {
  return {
    name: server.name,
    type: server.type,
    command: server.command ?? "",
    args: Array.isArray(server.args) ? server.args.map(String) : [],
    env: asStringRecord(server.env),
    url: server.url ?? "",
    headers: asStringRecord(server.headers),
  };
}

function asStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)]));
}
