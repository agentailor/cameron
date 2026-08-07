import { DATABASE, FAST_MODE, MODEL, RUN_POLICY } from "./config.mts";
import { prepareDatabase } from "./db.mts";
import { seed } from "./seed.mts";
import { runCase } from "./runner.mts";
import { cases } from "./cases.mts";
import type { EvalCase, GradeResult, RunCapture } from "./types.mts";

/**
 * Eval entry point: reset the sandbox DB, seed it, run every case against the real agent, print
 * results. Exits non-zero if any case failed.
 *
 * These are slow, paid, non-deterministic LLM runs — never part of `pnpm test`.
 */

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

interface CaseOutcome {
  testCase: EvalCase;
  runsAttempted: number;
  runsPassed: number;
  passed: boolean;
  /** Per-run grader results, for printing failures. */
  perRun: { results: GradeResult[]; capture: RunCapture }[];
}

// `-v` prints per-run timing and the tool trajectory as it goes.
const verbose = process.argv.includes("-v");

/** Both pools keep idle connections open, which holds the event loop past the last result. */
async function closePools(): Promise<void> {
  try {
    const { postgresCheckpointer } = await import("../src/lib/agent/memory.ts");
    await (postgresCheckpointer as unknown as { end?: () => Promise<void> }).end?.();
  } catch {
    // Never ran / already closed.
  }
  try {
    const pool = (globalThis as { pool?: { end?: () => Promise<void> } }).pool;
    await pool?.end?.();
  } catch {
    // Never ran / already closed.
  }
}

async function main() {
  const only = process.argv.slice(2).find((a) => !a.startsWith("-"));
  const selected = only ? cases.filter((c) => c.id.includes(only)) : cases;
  if (selected.length === 0) {
    console.error(`No cases match "${only}". Available: ${cases.map((c) => c.id).join(", ")}`);
    process.exit(1);
  }

  console.log(bold(`\nCameron evals — ${selected.length} case(s)`));
  console.log(dim(`  model: ${MODEL.provider} / ${MODEL.name}${FAST_MODE ? "  [fast mode]" : ""}`));

  const db = await prepareDatabase();
  console.log(dim(`  db: ${db.name} (sandbox, wiped)`));
  await seed(DATABASE.url);
  console.log(dim(`  seeded\n`));

  // Import AFTER DATABASE_URL is set — the db client binds the URL at module load.
  process.env.DATABASE_URL = DATABASE.url;
  const { getAgent } = await import("../src/lib/agent/index.ts");

  const outcomes: CaseOutcome[] = [];
  try {
    for (const testCase of selected) {
      // Fast mode collapses every case to a single run — for iterating, where you want the
      // trajectory rather than a statistically meaningful verdict.
      const policy = FAST_MODE ? RUN_POLICY.fast : (testCase.runs ?? RUN_POLICY.fast);
      const { n, passK } = policy;
      process.stdout.write(`  ${testCase.id} `);

      const perRun: CaseOutcome["perRun"] = [];
      for (let i = 0; i < n; i++) {
        // A fresh agent per run: no checkpointer state leaks between runs.
        const agent = await getAgent({
          provider: MODEL.provider,
          model: MODEL.name,
          approveAllTools: true,
        });
        const t0 = Date.now();
        const capture = await runCase(agent as never, testCase);
        const secs = ((Date.now() - t0) / 1000).toFixed(1);

        // An invoke that threw is a HARNESS problem until proven otherwise — say so loudly
        // rather than folding it into the pass/fail count as a quiet failure.
        if (capture.error) {
          console.log(red(`\n    ✗ run ${i + 1} threw after ${secs}s: ${capture.error}`));
        } else if (verbose) {
          const tools = capture.trajectory.map((t) => t.name).join(" → ") || "(none)";
          console.log(dim(`\n    run ${i + 1} ${secs}s | ${tools}`));
        }

        const results = capture.error
          ? [{ graderId: "invoke", passed: false, reason: capture.error }]
          : testCase.graders.map((g) => g.grade(capture));
        perRun.push({ results, capture });
        process.stdout.write(results.every((r) => r.passed) ? green("•") : red("•"));
      }

      const runsPassed = perRun.filter((r) => r.results.every((x) => x.passed)).length;
      const passed = runsPassed >= passK;
      console.log(` ${passed ? green("PASS") : red("FAIL")} ${dim(`(${runsPassed}/${n})`)}`);
      outcomes.push({ testCase, runsAttempted: n, runsPassed, passed, perRun });
    }
  } finally {
    // Seeded data stays — the next run wipes it, so a failure is left inspectable.
    await closePools();
  }

  // Detail for failures only — a passing case needs no explanation.
  const failed = outcomes.filter((o) => !o.passed);
  for (const o of failed) {
    console.log(bold(`\n─── ${o.testCase.id} ───`));
    if (o.testCase.description) console.log(dim(o.testCase.description));
    o.perRun.forEach((run, i) => {
      const bad = run.results.filter((r) => !r.passed);
      if (bad.length === 0) return;
      console.log(`\n  run ${i + 1}:`);
      for (const r of bad)
        console.log(red(`    ✗ ${r.graderId}`) + (r.reason ? ` — ${r.reason}` : ""));
      const tools = run.capture.trajectory.map((t) => t.name).join(" → ") || "(none)";
      console.log(dim(`    tools: ${tools}`));
      const answer = run.capture.finalText.replace(/\s+/g, " ").slice(0, 200);
      console.log(dim(`    said: ${answer}${answer.length >= 200 ? "…" : ""}`));
    });
  }

  const passedCount = outcomes.length - failed.length;
  console.log(bold(`\n${passedCount}/${outcomes.length} cases passed\n`));
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
