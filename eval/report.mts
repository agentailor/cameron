import { mkdirSync, writeFileSync } from "node:fs";
import type {
  ConversationTurn,
  EvalCase,
  GradeResult,
  Inconclusive,
  RunCapture,
} from "./types.mts";
import { DEFAULT_MAX_TURNS } from "./config.mts";
import { renderHtml } from "./viewer.mts";

/**
 * Persist a run to JSON: a timestamped file (history) plus `latest.json` (a stable path). Both
 * gitignored. See "Reports" in eval/README.md.
 */

const REPORT_DIR = "eval/results";

/** Filesystem-safe ISO timestamp: 2026-08-24T17-30-45 (':' -> '-', drop ms/zone). */
function fileTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d+Z$/, "")
    .replace(/:/g, "-");
}

export interface ReportCase {
  id: string;
  description?: string;
  /** A single turn, or the turns replayed for a multi-turn case. */
  prompt: string | string[];
  tags?: string[];
  /** `approval` implies the HITL middleware ran live for this case. */
  approval?: "allow" | "deny";
  /**
   * Present when the case ran with a simulated user. Fact VALUES are deliberately omitted — a
   * report is a shared artifact, and the count plus the goal is enough to explain the run.
   */
  user?: { goal: string; factCount: number; maxTurns: number };
  skipped: boolean;
  /** Every run produced no gradeable evidence. Not a failure — see eval/README.md. */
  inconclusive?: boolean;
  passed: boolean;
  runsAttempted: number;
  runsPassed: number;
  runs: {
    passed: boolean;
    /** Grader verdicts for THIS run — a majority failure is otherwise just a count. */
    results: GradeResult[];
    trajectory: string[];
    /** Tool calls the approval gate paused. Empty unless `approval` was set. */
    interrupts: string[];
    finalText: string;
    error?: string;
    /** Why this run produced nothing gradeable. Graders were skipped, so `results` is empty. */
    inconclusive?: Inconclusive;
    /**
     * What was actually said. Only a simulated run has this — and it is the ONLY place a
     * generated user turn is recorded, since `prompt` holds just the scripted opening.
     */
    conversation?: ConversationTurn[];
  }[];
}

export interface ReportFile {
  meta: {
    timestamp: string;
    provider: string;
    model: string;
    /** `fast` collapses every case to one run, including the ones that opt into repeats. */
    mode: "fast" | "repeats";
    /**
     * The model that played the USER, when any case simulated one. Recorded because changing it
     * invalidates comparison with older reports the same way a fixture change would.
     */
    simulator?: { provider: string; model: string; temperature: number };
    passed: number;
    graded: number;
    skipped: number;
    /** Cases where EVERY run was inconclusive, so the case tested nothing at all. */
    inconclusive: number;
    /**
     * Individual runs that produced no evidence, including those inside cases that still
     * passed. This is the number that moves first: a fact sheet missing something the agent
     * keeps asking for stalls one run in three while `inconclusive` stays 0.
     */
    inconclusiveRuns: number;
  };
  cases: ReportCase[];
}

export function buildReport(
  outcomes: {
    testCase: EvalCase;
    runsAttempted: number;
    runsPassed: number;
    passed: boolean;
    skipped?: boolean;
    inconclusive?: boolean;
    perRun: { results: GradeResult[]; capture: RunCapture }[];
  }[],
  meta: {
    provider: string;
    model: string;
    fast: boolean;
    simulator?: { provider: string; model: string; temperature: number };
  },
): ReportFile {
  const cases: ReportCase[] = outcomes.map((o) => ({
    id: o.testCase.id,
    description: o.testCase.description,
    prompt: o.testCase.prompt,
    tags: o.testCase.tags,
    approval: o.testCase.approval,
    ...(o.testCase.user
      ? {
          user: {
            goal: o.testCase.user.goal,
            factCount: o.testCase.user.facts.length,
            maxTurns: o.testCase.user.maxTurns ?? DEFAULT_MAX_TURNS,
          },
        }
      : {}),
    skipped: Boolean(o.skipped),
    ...(o.inconclusive ? { inconclusive: true } : {}),
    passed: o.passed,
    runsAttempted: o.runsAttempted,
    runsPassed: o.runsPassed,
    runs: o.perRun.map((r) => ({
      passed: r.results.every((x) => x.passed),
      results: r.results,
      trajectory: r.capture.trajectory.map((t) => t.name),
      interrupts: r.capture.interrupts.map((t) => t.name),
      finalText: r.capture.finalText,
      ...(r.capture.error ? { error: r.capture.error } : {}),
      ...(r.capture.inconclusive ? { inconclusive: r.capture.inconclusive } : {}),
      ...(r.capture.conversation ? { conversation: r.capture.conversation } : {}),
    })),
  }));

  const skipped = cases.filter((c) => c.skipped).length;
  const inconclusive = cases.filter((c) => c.inconclusive).length;
  const inconclusiveRuns = cases.reduce(
    (n, c) => n + c.runs.filter((r) => r.inconclusive).length,
    0,
  );
  // `graded` excludes both, so the headline passed/graded fraction only counts cases that
  // actually produced evidence.
  const graded = cases.length - skipped - inconclusive;

  return {
    meta: {
      timestamp: new Date().toISOString(),
      provider: meta.provider,
      model: meta.model,
      mode: meta.fast ? "fast" : "repeats",
      ...(meta.simulator ? { simulator: meta.simulator } : {}),
      passed: cases.filter((c) => c.passed && !c.skipped && !c.inconclusive).length,
      graded,
      skipped,
      inconclusive,
      inconclusiveRuns,
    },
    cases,
  };
}

/** Write the report; returns the stable path. Never throws — a run's results are worth more
 *  than the write succeeding, so a failure here degrades to a warning. */
export function writeReport(report: ReportFile): string | null {
  try {
    mkdirSync(REPORT_DIR, { recursive: true });
    const json = JSON.stringify(report, null, 2);
    writeFileSync(
      `${REPORT_DIR}/report-${fileTimestamp(new Date(report.meta.timestamp))}.json`,
      json,
    );
    const latest = `${REPORT_DIR}/latest.json`;
    writeFileSync(latest, json);
    // Same run as a standalone page — data inlined, so it opens straight from disk.
    writeFileSync(`${REPORT_DIR}/latest.html`, renderHtml(report));
    return latest;
  } catch (err) {
    console.error(
      `  (could not write report: ${err instanceof Error ? err.message : String(err)})`,
    );
    return null;
  }
}
