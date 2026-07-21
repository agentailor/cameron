import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Single Drizzle client for the application's own tables (Thread, MCPServer).
 * Uses the HMR-safe global-singleton pattern so Next.js dev hot-reloads don't
 * open a new pool on every module reload.
 *
 * The LangGraph checkpointer maintains its own separate pg connection and does
 * not go through this client.
 */
const globalForDb = globalThis as unknown as {
  pool?: Pool;
  db?: NodePgDatabase<typeof schema>;
};

const pool = globalForDb.pool || new Pool({ connectionString: process.env.DATABASE_URL });

export const db = globalForDb.db || drizzle(pool, { schema });

if (process.env.NODE_ENV !== "production") {
  globalForDb.pool = pool;
  globalForDb.db = db;
}

export default db;
