import { execSync } from "node:child_process";
import { Client } from "pg";
import { DATABASE } from "./config.mts";

/** Puts the sandbox database in a known state. Isolation itself is `compose.eval.yaml`'s job. */

/** Truncated together so FK order doesn't matter. */
const SEEDED_TABLES = ["transaction", "category"] as const;

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

  // drizzle-kit reads DATABASE_URL from the environment.
  execSync("pnpm exec drizzle-kit migrate", {
    env: { ...process.env, DATABASE_URL: DATABASE.url },
    stdio: "pipe",
  });

  await withClient((c) =>
    c.query(`TRUNCATE TABLE ${SEEDED_TABLES.join(", ")} RESTART IDENTITY CASCADE`),
  );

  return { name: DATABASE.name };
}
