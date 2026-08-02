import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const rootDir = import.meta.dirname;

/**
 * UNIT tests only — `pnpm test` never calls a model, hits the network, or needs a DB or API key.
 * Evals are a separate layer with their own config; keep them out of here. See docs/TESTING.md.
 */
export default defineConfig({
  resolve: {
    // Mirror tsconfig "paths": { "@/*": ["./src/*"] }.
    alias: { "@": resolve(rootDir, "src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // No setupFiles and no env loading — a unit test that needs either belongs in eval/.
    reporters: ["default"],
  },
});
