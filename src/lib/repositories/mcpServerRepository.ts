import { and, desc, eq, isNotNull } from "drizzle-orm";
import db from "@/lib/database/db";
import { mcpServers } from "@/lib/database/schema";
import { MCPServerType, type MCPServer } from "@/types/mcp";
import { ConflictError, isUniqueViolation } from "@/lib/database/errors";

/**
 * Persistence for MCP server configs, including the OAuth token/state columns. This is
 * the ONLY seam between the app and the ORM for MCP servers — callers use these functions
 * and receive plain domain objects ({@link MCPServer}), never Drizzle row types.
 *
 * Error translation (unique violation -> {@link ConflictError}) lives in
 * `@/lib/database/errors` and is shared with the other repositories.
 */

// Re-export so existing callers can keep importing ConflictError from this module.
export { ConflictError };

type MCPServerRow = typeof mcpServers.$inferSelect;

function toDomain(row: MCPServerRow): MCPServer {
  return {
    id: row.id,
    name: row.name,
    type: row.type as MCPServerType,
    enabled: row.enabled,
    command: row.command,
    args: row.args,
    env: row.env,
    url: row.url,
    headers: row.headers,
    requiresAuth: row.requiresAuth,
    authTokens: row.authTokens,
    clientInfo: row.clientInfo,
    codeVerifier: row.codeVerifier,
    oauthStatus: row.oauthStatus,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function now(): string {
  return new Date().toISOString();
}

export interface CreateMCPServerInput {
  name: string;
  type: MCPServerType;
  command?: string | null;
  args?: unknown;
  env?: unknown;
  url?: string | null;
  headers?: unknown;
}

export interface UpdateMCPServerPatch {
  name?: string;
  type?: MCPServerType;
  enabled?: boolean;
  command?: string | null;
  args?: unknown;
  env?: unknown;
  url?: string | null;
  headers?: unknown;
}

export async function list(): Promise<MCPServer[]> {
  const rows = await db.select().from(mcpServers).orderBy(desc(mcpServers.createdAt));
  return rows.map(toDomain);
}

export async function listEnabled(): Promise<MCPServer[]> {
  const rows = await db.select().from(mcpServers).where(eq(mcpServers.enabled, true));
  return rows.map(toDomain);
}

export async function getById(id: string): Promise<MCPServer | null> {
  const rows = await db.select().from(mcpServers).where(eq(mcpServers.id, id)).limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

/** Find an HTTP server (with a url) by id — used by the OAuth check route. */
export async function getHttpById(id: string): Promise<MCPServer | null> {
  const rows = await db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.id, id), eq(mcpServers.type, "http"), isNotNull(mcpServers.url)))
    .limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

/** Create a server. Throws {@link ConflictError} if the name is taken. */
export async function create(input: CreateMCPServerInput): Promise<MCPServer> {
  const timestamp = now();
  try {
    const [row] = await db
      .insert(mcpServers)
      .values({
        id: crypto.randomUUID(),
        name: input.name,
        type: input.type,
        command: input.command ?? null,
        args: input.args ?? null,
        env: input.env ?? null,
        url: input.url ?? null,
        headers: input.headers ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning();
    return toDomain(row);
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError("MCP server name already exists");
    throw err;
  }
}

/**
 * Apply a partial update. Returns the updated record, or null if no such server exists.
 * Throws {@link ConflictError} if renaming to a name that is taken.
 */
export async function update(id: string, patch: UpdateMCPServerPatch): Promise<MCPServer | null> {
  try {
    const [row] = await db
      .update(mcpServers)
      .set({ ...patch, updatedAt: now() })
      .where(eq(mcpServers.id, id))
      .returning();
    return row ? toDomain(row) : null;
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError("MCP server name already exists");
    throw err;
  }
}

/** Delete a server. Returns true if a row was removed, false if it did not exist. */
export async function remove(id: string): Promise<boolean> {
  const rows = await db
    .delete(mcpServers)
    .where(eq(mcpServers.id, id))
    .returning({ id: mcpServers.id });
  return rows.length > 0;
}

// --- OAuth-specific helpers (used by ServerOAuthProvider / oauth routes) ---

export async function getClientInfo(id: string): Promise<unknown> {
  const rows = await db
    .select({ clientInfo: mcpServers.clientInfo })
    .from(mcpServers)
    .where(eq(mcpServers.id, id))
    .limit(1);
  return rows[0]?.clientInfo;
}

export async function saveClientInfo(id: string, clientInfo: unknown): Promise<void> {
  await db.update(mcpServers).set({ clientInfo, updatedAt: now() }).where(eq(mcpServers.id, id));
}

export async function getTokens(id: string): Promise<unknown> {
  const rows = await db
    .select({ authTokens: mcpServers.authTokens })
    .from(mcpServers)
    .where(eq(mcpServers.id, id))
    .limit(1);
  return rows[0]?.authTokens;
}

export async function saveTokens(
  id: string,
  authTokens: unknown,
  oauthStatus?: string,
): Promise<void> {
  await db
    .update(mcpServers)
    .set({ authTokens, ...(oauthStatus ? { oauthStatus } : {}), updatedAt: now() })
    .where(eq(mcpServers.id, id));
}

export async function getCodeVerifier(id: string): Promise<string | null> {
  const rows = await db
    .select({ codeVerifier: mcpServers.codeVerifier })
    .from(mcpServers)
    .where(eq(mcpServers.id, id))
    .limit(1);
  return rows[0]?.codeVerifier ?? null;
}

export async function saveCodeVerifier(id: string, codeVerifier: string): Promise<void> {
  await db.update(mcpServers).set({ codeVerifier, updatedAt: now() }).where(eq(mcpServers.id, id));
}

export async function setOAuthStatus(id: string, oauthStatus: string): Promise<void> {
  await db.update(mcpServers).set({ oauthStatus, updatedAt: now() }).where(eq(mcpServers.id, id));
}

/** Mark a server successfully connected and clear the transient code verifier. */
export async function markConnected(id: string): Promise<void> {
  await db
    .update(mcpServers)
    .set({ oauthStatus: "CONNECTED", requiresAuth: true, codeVerifier: null, updatedAt: now() })
    .where(eq(mcpServers.id, id));
}
