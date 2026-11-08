// Must be first: loads .env.local before db.ts (imported transitively below) builds its pg pool.
import "@/lib/database/loadEnv";
import { SECRET_KEY_ENV, parseKey } from "@/lib/crypto/secretBox";
import { resealAllSecrets } from "@/lib/repositories/mcpServerRepository";

/**
 * One-off: encrypt MCP server credentials written before at-rest encryption existed.
 * Safe to re-run. Run with: `pnpm db:encrypt-secrets` (targets DATABASE_URL).
 */
async function main() {
  parseKey(process.env[SECRET_KEY_ENV]); // fail before touching any row
  const target = new URL(process.env.DATABASE_URL ?? "postgresql://unset");
  console.log(`Encrypting mcp_server credentials in ${target.host}${target.pathname}`);
  const { rows, migrated } = await resealAllSecrets();
  console.log(`${migrated} of ${rows} server(s) had plaintext credentials; now encrypted.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
