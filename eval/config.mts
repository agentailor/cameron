/**
 * Every knob that decides what an eval run does — model, run policy, limits, sandbox DB.
 *
 * Config owns WHAT (model id, counts, timeouts); the other modules own HOW (building the agent,
 * driving Postgres). Answering "what will this run cost and how many API calls is it?" should
 * never take more than this file.
 *
 * Not a `.env`: the values live here with the reasoning next to them, typed and committed.
 * Individual knobs still take an env override for one-off comparisons.
 */

/** Model under test. `EVAL_MODEL=claude-sonnet-5 pnpm eval` to compare without editing code. */
export const MODEL = {
  provider: "anthropic",
  /** Keep in sync with DEFAULT_MODEL_NAME (src/lib/agent/util.ts) — evals should test what ships. */
  name: process.env.EVAL_MODEL ?? "claude-haiku-4-5",
} as const;

/**
 * How many times to run each case, and how many must pass.
 *
 * Agents are non-deterministic: one run proves nothing about a flaky behavior. `verdict` is the
 * default — repeat and require a majority. `fast` (EVAL_MODE=fast) drops to a single run for
 * iterating, where you just want to see the trajectory and don't need the count to mean anything.
 */
export const RUN_POLICY = {
  verdict: { n: 3, passK: 2 },
  /** Unanimous — for cases where any failure is a real defect. */
  strict: { n: 3, passK: 3 },
  fast: { n: 1, passK: 1 },
} as const;

export type RunPolicy = (typeof RUN_POLICY)[keyof typeof RUN_POLICY];

/** `EVAL_MODE=fast` collapses every case to one run. */
export const FAST_MODE = process.env.EVAL_MODE === "fast";

export const LIMITS = {
  /** Bounds the agent loop: a case that keeps calling tools fails instead of burning budget. */
  recursionLimit: 25,
  /** Per-run wall clock. Generous — a slow answer is a finding, not a harness failure. */
  timeoutMs: 120_000,
} as const;

/** The sandbox database, provisioned by `compose.eval.yaml` on its own port. */
export const DATABASE = {
  url: process.env.DATABASE_URL ?? "postgresql://user:password@localhost:5545/cameron_eval",
  /** `db.mts` refuses to TRUNCATE anything else. */
  name: "cameron_eval",
} as const;
