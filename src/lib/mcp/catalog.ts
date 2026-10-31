import {
  refreshServerCatalog,
  type DisclosureServer,
  type ServerCatalogEntry,
  type ServerManifest,
} from "@agentailor/mcp-disclosure";
import * as mcpServerRepo from "@/lib/repositories/mcpServerRepository";
import * as catalogRepo from "@/lib/repositories/mcpServerCatalogRepository";
import type { ServerToolsError } from "@/lib/agent/mcp";
import { ConnectError, needsAuth, openSession } from "@/lib/mcp/connector";
import { createServerSummarizer } from "@/lib/mcp/summarize";
import type { MCPServer } from "@/types/mcp";

export type CatalogRefreshResult =
  | { ok: true; entry: ServerCatalogEntry }
  | { ok: false; error: ServerToolsError | "not_found"; message: string };

/** Opens a short-lived session (not the pool's: the settings may have just changed) to read it. */
async function fetchManifest(server: MCPServer): Promise<ServerManifest> {
  const session = await openSession(server);
  try {
    return await session.manifest();
  } finally {
    await session.close().catch(() => {});
  }
}

/** Writes a catalog row from a manifest already read — e.g. by a pooled session. */
export async function refreshFromManifest(
  server: MCPServer,
  manifest: ServerManifest,
): Promise<ServerCatalogEntry> {
  return refreshServerCatalog(server, {
    fetchManifest: async () => manifest,
    readEntry: () => catalogRepo.get(server.id),
    writeEntry: catalogRepo.upsert,
    // The owner's description wins, so a generated one would never be shown.
    summarize: server.description ? undefined : await createServerSummarizer(),
  });
}

/** How long a chat message waits for a missing catalog row; the refresh itself keeps going. */
export const CATALOG_WAIT_MS = 5_000;

const inFlight = new Map<string, Promise<CatalogRefreshResult>>();

/** One refresh per server version at a time, so repeated messages don't spawn it repeatedly. */
function refresh(server: MCPServer): Promise<CatalogRefreshResult> {
  const key = `${server.id}:${server.updatedAt.toISOString()}`;
  const running = inFlight.get(key);
  if (running) return running;
  const started = runRefresh(server).finally(() => inFlight.delete(key));
  inFlight.set(key, started);
  return started;
}

async function runRefresh(server: MCPServer): Promise<CatalogRefreshResult> {
  try {
    const entry = await refreshFromManifest(server, await fetchManifest(server));
    return { ok: true, entry };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof ConnectError ? error.code : "connect_failed";
    console.warn(`[mcp-disclosure] catalog refresh failed for ${server.name}: ${message}`);
    return { ok: false, error: code, message };
  }
}

/** Connects to the server and rewrites its catalog row. A failure keeps the previous row. */
export async function refreshServerCatalogById(id: string): Promise<CatalogRefreshResult> {
  const server = await mcpServerRepo.getById(id);
  if (!server) return { ok: false, error: "not_found", message: "Server not found" };
  return refresh(server);
}

/** For `after()` in routes: never throws, so a refresh can't fail the request that queued it. */
export async function refreshCatalogQuietly(id: string): Promise<void> {
  await refreshServerCatalogById(id).catch((error) =>
    console.warn(`[mcp-disclosure] catalog refresh crashed for ${id}:`, error),
  );
}

export interface LoadedServers {
  /** What the disclosure middleware sees. */
  servers: DisclosureServer[];
  /** The enabled rows, for connecting on demand. */
  records: MCPServer[];
  catalogs: Map<string, ServerCatalogEntry>;
}

/** A missing row's refresh, waited on for at most {@link CATALOG_WAIT_MS}. */
async function refreshWithinWait(server: MCPServer): Promise<ServerCatalogEntry | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    refresh(server),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), CATALOG_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
  if (result === null) {
    console.log(`[mcp-disclosure] ${server.name}: still refreshing, unavailable for this message`);
  }
  return result?.ok ? result.entry : null;
}

/**
 * Every enabled server with its catalog row. Nothing connects here unless a server has no row
 * (the first request after it was added, or a refresh that never ran) — then a refresh runs, and
 * a server it can't finish in time is returned with `catalog: null`: unavailable for this
 * message, never an error.
 */
export async function loadDisclosureServers(): Promise<LoadedServers> {
  try {
    const records = await mcpServerRepo.listEnabled();
    const rows = await catalogRepo.listByServerIds(records.map((s) => s.id));
    const catalogs = new Map(rows.map((r) => [r.serverId, r]));
    const servers = await Promise.all(
      records.map(async (server) => {
        let catalog = catalogs.get(server.id) ?? null;
        if (!catalog) {
          catalog = await refreshWithinWait(server);
          if (catalog) catalogs.set(server.id, catalog);
        }
        return {
          id: server.id,
          name: server.name,
          description: server.description,
          authRequired: needsAuth(server),
          catalog,
        };
      }),
    );
    return { servers, records, catalogs };
  } catch (error) {
    console.error("[mcp-disclosure] failed to load the server catalog:", error);
    return { servers: [], records: [], catalogs: new Map() };
  }
}
