import { inArray, eq } from "drizzle-orm";
import type {
  McpToolDefinition,
  ServerCatalogEntry,
  SummarySource,
} from "@agentailor/mcp-disclosure";
import db from "@/lib/database/db";
import { columnToDate } from "@/lib/database/timestamps";
import { mcpServerCatalog } from "@/lib/database/schema";

/**
 * Persistence for the cached per-server tool catalog. The ONLY ORM seam for
 * `mcp_server_catalog`; rows come back as the disclosure package's {@link ServerCatalogEntry}.
 * Deleting a server cascades to its row.
 */

type CatalogRow = typeof mcpServerCatalog.$inferSelect;

function toDomain(row: CatalogRow): ServerCatalogEntry {
  return {
    serverId: row.serverId,
    toolsHash: row.toolsHash,
    tools: row.tools as McpToolDefinition[],
    toolCount: row.toolCount,
    schemaTokens: row.schemaTokens,
    summary: row.summary,
    summarySource: row.summarySource as SummarySource,
    refreshedAt: columnToDate(row.refreshedAt),
  };
}

export async function get(serverId: string): Promise<ServerCatalogEntry | null> {
  const rows = await db
    .select()
    .from(mcpServerCatalog)
    .where(eq(mcpServerCatalog.serverId, serverId))
    .limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function listByServerIds(serverIds: string[]): Promise<ServerCatalogEntry[]> {
  if (serverIds.length === 0) return [];
  const rows = await db
    .select()
    .from(mcpServerCatalog)
    .where(inArray(mcpServerCatalog.serverId, serverIds));
  return rows.map(toDomain);
}

export async function upsert(entry: ServerCatalogEntry): Promise<void> {
  const values = {
    toolsHash: entry.toolsHash,
    tools: entry.tools,
    toolCount: entry.toolCount,
    schemaTokens: entry.schemaTokens,
    summary: entry.summary,
    summarySource: entry.summarySource,
    refreshedAt: entry.refreshedAt.toISOString(),
  };
  await db
    .insert(mcpServerCatalog)
    .values({ serverId: entry.serverId, ...values })
    .onConflictDoUpdate({ target: mcpServerCatalog.serverId, set: values });
}
