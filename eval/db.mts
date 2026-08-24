import { execSync } from "node:child_process";
import { Client } from "pg";
import { DATABASE } from "./config.mts";
import { seed } from "./seed.mts";

/** Puts the sandbox database in a known state. Isolation itself is `compose.eval.yaml`'s job. */

/** Truncated together so FK order doesn't matter. */
const SEEDED_TABLES = ["transaction", "category"] as const;

/** Tables a grader is allowed to count. Keeps an arbitrary string out of an interpolated query. */
export type CountableTable = (typeof SEEDED_TABLES)[number];

async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DATABASE.url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** This module TRUNCATEs — refuse any database that isn't the sandbox. */
function assertEvalDatabase(): void {
  const name = new URL(DATABASE.url).pathname.replace(/^\//, "");
  if (name !== DATABASE.name) {
    throw new Error(
      `Refusing to run: eval database must be "${DATABASE.name}", got "${name}". ` +
        `Evals TRUNCATE the database they connect to. Check DATABASE_URL / .env.eval.`,
    );
  }
}

/**
 * Migrate, then wipe. Runs before each eval, not after: a crashed run would otherwise leave rows
 * that become the next run's fixture. Safe on an empty or dirty database.
 */
export async function prepareDatabase(): Promise<{ name: string }> {
  assertEvalDatabase();

  // drizzle-kit reads DATABASE_URL from the environment. Its failure output is a Node stack trace
  // that buries the usual cause — the sandbox stack simply isn't up — so translate it.
  try {
    execSync("pnpm exec drizzle-kit migrate", {
      env: { ...process.env, DATABASE_URL: DATABASE.url },
      stdio: "pipe",
    });
  } catch {
    const { port } = new URL(DATABASE.url);
    throw new Error(
      `Could not migrate the eval database at ${DATABASE.url}.\n` +
        `  The sandbox stack is probably not running. Start it with:\n\n` +
        `    docker compose -f compose.eval.yaml up -d\n\n` +
        `  (expects Postgres on port ${port}; check with: docker ps --filter name=cameron-eval)`,
    );
  }

  await withClient((c) =>
    c.query(`TRUNCATE TABLE ${SEEDED_TABLES.join(", ")} RESTART IDENTITY CASCADE`),
  );

  return { name: DATABASE.name };
}

/**
 * Wipe and re-seed WITHOUT re-migrating — cheap enough to run between individual runs.
 *
 * Mutating cases (anything with `approval`) write to the ledger, so run 2 would otherwise start
 * from run 1's leftovers and every row-count assertion would drift. Read-only cases don't need it.
 */
export async function resetToFixture(): Promise<void> {
  assertEvalDatabase();
  await withClient((c) =>
    c.query(`TRUNCATE TABLE ${SEEDED_TABLES.join(", ")} RESTART IDENTITY CASCADE`),
  );
  await seed(DATABASE.url);
}

/** Count rows in a seeded table. The only way to prove what a run actually wrote. */
export async function countRows(table: CountableTable): Promise<number> {
  assertEvalDatabase();
  return withClient(async (c) => {
    const { rows } = await c.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM ${table}`,
    );
    return Number(rows[0]?.count ?? 0);
  });
}
