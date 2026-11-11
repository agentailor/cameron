import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * Writes the `tools/list` of servers connected in the DEV app into `snapshots/`, to be used as
 * distractors. Reads `mcp_server_catalog` only: tool names, descriptions and input schemas, never
 * a server's env, headers or tokens.
 *
 *   pnpm bench:mcp:export notionApi google-workspace
 *
 * Files are numbered in the order given; the benchmark adds them in filename order.
 */

const SOURCE =
  process.env.BENCH_SOURCE_DATABASE_URL ?? "postgresql://user:password@localhost:5544/mydb_dev";

async function main() {
  const names = process.argv.slice(2);
  if (names.length === 0) {
    console.error("Name the servers to export, in the order they should be added.");
    process.exit(1);
  }
  const start = Number(process.env.BENCH_SNAPSHOT_START ?? 1);
  const dir = join(dirname(fileURLToPath(import.meta.url)), "snapshots");
  mkdirSync(dir, { recursive: true });

  const client = new pg.Client({ connectionString: SOURCE });
  await client.connect();
  try {
    for (const [i, name] of names.entries()) {
      const { rows } = await client.query(
        `select s.name, s.description, c.summary, c.tools
           from mcp_server s join mcp_server_catalog c on c.server_id = s.id
          where s.name = $1`,
        [name],
      );
      if (rows.length === 0) {
        console.error(`  ${name}: not found, or it has no catalog yet (connect it first)`);
        continue;
      }
      const row = rows[0];
      const tools = (
        row.tools as { name: string; description?: string; inputSchema?: unknown }[]
      ).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
      const file = `${String(start + i).padStart(2, "0")}-${name}.json`;
      writeFileSync(
        join(dir, file),
        JSON.stringify({ name: row.name, summary: row.description || row.summary, tools }, null, 2),
      );
      console.log(`  ${file}: ${tools.length} tools`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
