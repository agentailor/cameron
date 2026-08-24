import { mkdirSync, writeFileSync } from "node:fs";
import type { EvalCase, GradeResult, RunCapture } from "./types.mts";

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
  prompt: string;
  tags?: string[];
  /** `approval` implies the HITL middleware ran live for this case. */
  approval?: "allow" | "deny";
  skipped: boolean;
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
  }[];
}

export interface ReportFile {
  meta: {
    timestamp: string;
    provider: string;
    model: string;
    /** `fast` runs once per case — a green report in this mode is NOT a verdict. */
    mode: "fast" | "verdict";
    passed: number;
    graded: number;
    skipped: number;
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
    perRun: { results: GradeResult[]; capture: RunCapture }[];
  }[],
  meta: { provider: string; model: string; fast: boolean },
): ReportFile {
  const cases: ReportCase[] = outcomes.map((o) => ({
    id: o.testCase.id,
    description: o.testCase.description,
    prompt: o.testCase.prompt,
    tags: o.testCase.tags,
    approval: o.testCase.approval,
    skipped: Boolean(o.skipped),
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
    })),
  }));

  const skipped = cases.filter((c) => c.skipped).length;
  const graded = cases.length - skipped;

  return {
    meta: {
      timestamp: new Date().toISOString(),
      provider: meta.provider,
      model: meta.model,
      mode: meta.fast ? "fast" : "verdict",
      passed: cases.filter((c) => c.passed && !c.skipped).length,
      graded,
      skipped,
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
    return latest;
  } catch (err) {
    console.error(
      `  (could not write report: ${err instanceof Error ? err.message : String(err)})`,
    );
    return null;
  }
}
