import { execSync } from "node:child_process";
import { Client } from "pg";
import { DATABASE } from "./config.mts";
import { seed } from "./seed.mts";

/** Puts the sandbox database in a known state. Isolation itself is `compose.eval.yaml`'s job. */

/** Truncated together so FK order doesn't matter. */
const SEEDED_TABLES = ["transaction", "category"] as const;

/**
 * Everything wiped between runs. `config` is not seeded but MUST be cleared: a case that sets the
 * owner's currency would otherwise leave it set, and the next case — whose whole point is an
 * unestablished setting — would start already answered.
 */
const RESET_TABLES = [...SEEDED_TABLES, "config"] as const;

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
    c.query(`TRUNCATE TABLE ${RESET_TABLES.join(", ")} RESTART IDENTITY CASCADE`),
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
    c.query(`TRUNCATE TABLE ${RESET_TABLES.join(", ")} RESTART IDENTITY CASCADE`),
  );
  // The CSV fixture lives in the object store, which TRUNCATE doesn't touch.
  await seed(DATABASE.url, { withCsv: false });
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

/** Rows imported from a CSV, i.e. everything the fixture did not seed. */
export async function countImportedRows(): Promise<number> {
  assertEvalDatabase();
  return withClient(async (c) => {
    const { rows } = await c.query<{ count: string }>(
      "SELECT COUNT(*)::int AS count FROM transaction WHERE source <> 'eval'",
    );
    return Number(rows[0]?.count ?? 0);
  });
}

/**
 * Calendar months (1-12) the imported rows landed on, with a count each.
 *
 * The whole point of the CSV date cases: a wrong `dateFormat` imports successfully and silently,
 * and the stored month is the only thing that distinguishes 5 July from 7 May.
 */
export async function importedMonths(): Promise<{ month: number; count: number }[]> {
  assertEvalDatabase();
  return withClient(async (c) => {
    const { rows } = await c.query<{ month: string; count: string }>(
      `SELECT EXTRACT(MONTH FROM occurred_at)::int AS month, COUNT(*)::int AS count
       FROM transaction WHERE source <> 'eval'
       GROUP BY 1 ORDER BY 1`,
    );
    return rows.map((r) => ({ month: Number(r.month), count: Number(r.count) }));
  });
}

/** Imported rows that got a category, by category name. Proves a mapped column was not dropped. */
export async function importedCategoryNames(): Promise<string[]> {
  assertEvalDatabase();
  return withClient(async (c) => {
    const { rows } = await c.query<{ name: string }>(
      `SELECT DISTINCT cat.name FROM transaction t
       JOIN category cat ON cat.id = t.category_id
       WHERE t.source <> 'eval' ORDER BY 1`,
    );
    return rows.map((r) => r.name);
  });
}

/**
 * Distinct currency codes on the imported rows, with a count each.
 *
 * The currency case's evidence. A bulk import under the wrong code is silent in a way the date
 * case is not even silent about: every row is internally consistent, the totals are right, and
 * only the code itself is wrong — so the stored value is the only thing that can be graded.
 */
export async function importedCurrencies(): Promise<{ currency: string; count: number }[]> {
  assertEvalDatabase();
  return withClient(async (c) => {
    const { rows } = await c.query<{ currency: string; count: string }>(
      `SELECT currency, COUNT(*)::int AS count
       FROM transaction WHERE source <> 'eval'
       GROUP BY 1 ORDER BY 1`,
    );
    return rows.map((r) => ({ currency: r.currency, count: Number(r.count) }));
  });
}

/** A stored owner setting, or null if the run never established it. */
export async function configValue(key: string): Promise<string | null> {
  assertEvalDatabase();
  return withClient(async (c) => {
    const { rows } = await c.query<{ value: string }>(
      "SELECT value FROM config WHERE key = $1 LIMIT 1",
      [key],
    );
    return rows[0]?.value ?? null;
  });
}

/**
 * Pre-set owner settings for a case that must START from an established setting.
 *
 * `config` is in RESET_TABLES, so every run begins with it empty — correct for cases about
 * establishing a value, useless for cases about REUSING one. A case declaring `config` gets its
 * rows written after the reset.
 */
export async function seedConfig(entries: Record<string, string>): Promise<void> {
  assertEvalDatabase();
  const pairs = Object.entries(entries);
  if (pairs.length === 0) return;
  await withClient(async (c) => {
    for (const [key, value] of pairs) {
      await c.query(
        `INSERT INTO config (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, value],
      );
    }
  });
}

/**
 * Currencies on MANUALLY logged rows (source 'manual'), with a count each.
 *
 * Separate from `importedCurrencies`: that one covers everything the fixture didn't seed, which
 * lumps a CSV import together with a logged expense. A `log_expense` case needs to see its own
 * row and nothing else.
 */
export async function loggedCurrencies(): Promise<{ currency: string; count: number }[]> {
  assertEvalDatabase();
  return withClient(async (c) => {
    const { rows } = await c.query<{ currency: string; count: string }>(
      `SELECT currency, COUNT(*)::int AS count
       FROM transaction WHERE source = 'manual'
       GROUP BY 1 ORDER BY 1`,
    );
    return rows.map((r) => ({ currency: r.currency, count: Number(r.count) }));
  });
}
