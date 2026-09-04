import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load env the way Next.js does: `.env.local` takes precedence, then `.env`. drizzle-kit runs
// outside Next, so without this the db:* scripts wouldn't see DATABASE_URL (which lives in
// `.env.local`). dotenv does not overwrite already-set vars, so the first file listed wins.
loadEnv({ path: [".env.local", ".env"] });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/database/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // The LangGraph checkpointer owns its own tables; keep drizzle-kit from
  // touching anything it doesn't manage.
  tablesFilter: ["thread", "mcp_server", "category", "transaction", "config"],
});
