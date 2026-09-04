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
 * The model that plays the USER in a simulated case, pinned SEPARATELY from the model under test.
 *
 * Separate on purpose: moved together, a suite-wide swing could not be attributed — you would not
 * know whether the agent got worse or the user got weirder. Treat a change here the way you would
 * treat a fixture change: it invalidates comparison with older reports, which is why every report
 * records it.
 *
 * Temperature 0 because the simulator is INPUT, and input to a measurement should not be a source
 * of variance. Deliberately small and boring: its job is to relay a fact from a list, not to reason.
 */
export const SIMULATOR_MODEL = {
  provider: "anthropic",
  name: process.env.EVAL_SIMULATOR_MODEL ?? "claude-haiku-4-5",
  temperature: 0,
} as const;

/**
 * How many times to run each case, and how many must pass (pass@k).
 *
 * The default is ONE run. Repeating is opt-in per case, because repeats buy information only where
 * the behavior is genuinely unstable — see "Run policy" in eval/README.md for when to spend them.
 *
 * A project that gates merges on its evals would default the other way: there, an unrepeated green
 * can't be told apart from a lucky one. Cameron's suite is a teaching artifact and gates nothing,
 * so paying 3x on every case buys nothing on most of them.
 */
export const RUN_POLICY = {
  /** The default. Enough for a structural assertion that is near-deterministic. */
  single: { n: 1, passK: 1 },
  /** Repeat and require a majority — for behavior known to vary run to run. */
  majority: { n: 3, passK: 2 },
  /** Unanimous — for a wrong outcome that is silent, unrecoverable, or both. */
  strict: { n: 3, passK: 3 },
  fast: { n: 1, passK: 1 },
} as const;

export type RunPolicy = (typeof RUN_POLICY)[keyof typeof RUN_POLICY];

/**
 * The default for a case with a simulated `user` — an exception to the opt-in rule above, because a
 * simulated conversation compounds the simulator's variance with the agent's (see eval/README.md).
 *
 * `majority` rather than `strict`: unanimity across compounded variance produces reds that mean
 * "the conversation went differently", not "the agent regressed". A simulated case whose wrong
 * outcome is SILENT can still opt into `strict` and say why.
 */
export const SIMULATED_DEFAULT = RUN_POLICY.majority;

/** Cap on user turns when a simulated case doesn't set its own. */
export const DEFAULT_MAX_TURNS = 6;

/** `EVAL_MODE=fast` collapses every case to one run. */
export const FAST_MODE = process.env.EVAL_MODE === "fast";

/**
 * `EVAL_RUNS=5 pnpm eval <id>` forces n runs on every selected case, requiring ALL to pass.
 *
 * For deliberately measuring stability — a behavior that passed once is not known to be reliable,
 * and a case's own policy is set for routine runs, not for interrogating a fresh change. Ignored
 * in fast mode, which means the opposite thing.
 */
export const FORCED_RUNS = process.env.EVAL_RUNS ? Number(process.env.EVAL_RUNS) : undefined;

export const LIMITS = {
  /** Bounds the agent loop: a case that keeps calling tools fails instead of burning budget. */
  recursionLimit: 25,
  /**
   * Per AGENT TURN wall clock — one user message in, one reply out. Generous: a slow answer is a
   * finding, not a harness failure.
   */
  timeoutMs: 120_000,
  /**
   * Whole-conversation budget for a simulated case, across every turn.
   *
   * Separate from `timeoutMs` because a simulated conversation has an unknown number of turns: one
   * signal covering all of them would abort mid-conversation and surface as a THROW, which reads as
   * an agent crash. Running out of budget is `inconclusive` instead.
   */
  conversationTimeoutMs: 600_000,
} as const;

/** The sandbox database, provisioned by `compose.eval.yaml` on its own port. */
export const DATABASE = {
  url: process.env.DATABASE_URL ?? "postgresql://user:password@localhost:5545/cameron_eval",
  /** `db.mts` refuses to TRUNCATE anything else. */
  name: "cameron_eval",
} as const;
