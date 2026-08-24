import { DATABASE, FAST_MODE, MODEL, RUN_POLICY } from "./config.mts";
import { prepareDatabase, resetToFixture } from "./db.mts";
import { seed } from "./seed.mts";
import { runCase } from "./runner.mts";
import { cases } from "./cases/index.mts";
import { buildReport, writeReport } from "./report.mts";
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
  /** True when the case declared `skip` — reported, never executed, never counted as a failure. */
  skipped?: boolean;
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
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));

  // `EVAL_MODE=fast pnpm eval …` is bash syntax. In PowerShell there is no inline env-var prefix,
  // so it arrives here as a literal argument and the run silently does the wrong thing.
  const misplacedEnv = args.find((a) => a.includes("="));
  if (misplacedEnv) {
    const [name, value] = misplacedEnv.split("=");
    console.error(
      `\n"${misplacedEnv}" was passed as an argument, not an environment variable.\n\n` +
        `  PowerShell:  $env:${name}="${value}"; pnpm eval\n` +
        `  bash:        ${misplacedEnv} pnpm eval\n`,
    );
    process.exit(1);
  }

  // Match on id OR tag: an id-only filter silently drops cases whose name doesn't happen to
  // contain the filter word, which looks like a complete run.
  const only = args[0];
  const selected = only
    ? cases.filter((c) => c.id.includes(only) || (c.tags ?? []).includes(only))
    : cases;
  if (selected.length === 0) {
    const tags = [...new Set(cases.flatMap((c) => c.tags ?? []))];
    console.error(
      `No cases match "${only}".\n  ids:  ${cases.map((c) => c.id).join(", ")}\n  tags: ${tags.join(", ")}`,
    );
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
      if (testCase.skip) {
        console.log(`  ${testCase.id} ${dim("SKIP")}`);
        outcomes.push({
          testCase,
          runsAttempted: 0,
          runsPassed: 0,
          passed: true,
          skipped: true,
          perRun: [],
        });
        continue;
      }

      // Fast mode collapses every case to a single run — for iterating, where you want the
      // trajectory rather than a statistically meaningful verdict. Otherwise a case that doesn't
      // declare a policy gets the majority verdict: defaulting to a single run would make a green
      // suite mean nothing.
      const policy = FAST_MODE ? RUN_POLICY.fast : (testCase.runs ?? RUN_POLICY.verdict);
      const { n, passK } = policy;
      process.stdout.write(`  ${testCase.id} `);

      const perRun: CaseOutcome["perRun"] = [];
      for (let i = 0; i < n; i++) {
        // An approval case mutates, so each run must start from the same ledger — otherwise run 2
        // inherits run 1's writes and every row-count assertion drifts.
        if (testCase.approval) await resetToFixture();

        // A fresh agent per run: no checkpointer state leaks between runs. `approveAllTools`
        // omits the HITL middleware entirely, so a case testing the gate must NOT set it.
        const agent = await getAgent({
          provider: MODEL.provider,
          model: MODEL.name,
          approveAllTools: !testCase.approval,
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
          const gated = capture.interrupts.map((t) => t.name).join(", ");
          console.log(
            dim(`\n    run ${i + 1} ${secs}s | ${tools}${gated ? ` | paused: ${gated}` : ""}`),
          );
        }

        // Graders may be async (rowCountInStore reads the sandbox DB back).
        const results = capture.error
          ? [{ graderId: "invoke", passed: false, reason: capture.error }]
          : await Promise.all(testCase.graders.map((g) => g.grade(capture)));
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
  const failed = outcomes.filter((o) => !o.passed && !o.skipped);
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

  const skipped = outcomes.filter((o) => o.skipped).length;
  const graded = outcomes.length - skipped;
  const passedCount = graded - failed.length;
  console.log(
    bold(`\n${passedCount}/${graded} cases passed`) + (skipped ? dim(` (${skipped} skipped)`) : ""),
  );

  // The console output scrolls away; the report is what survives the run.
  const path = writeReport(
    buildReport(outcomes, { provider: MODEL.provider, model: MODEL.name, fast: FAST_MODE }),
  );
  if (path) console.log(dim(`  report: ${path}`));
  console.log();

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
