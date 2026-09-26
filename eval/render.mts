import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { ReportFile } from "./report.mts";
import { renderHtml } from "./viewer.mts";

/**
 * Render a saved report JSON to standalone HTML — `pnpm eval` only writes `latest.html`, so older
 * runs survive as JSON with nothing to display them. See "Reading an older run" in eval/README.md.
 *
 *   pnpm eval:render --list                           # what's on disk
 *   pnpm eval:render                                  # newest timestamped report
 *   pnpm eval:render eval/results/report-2026-….json  # a specific one
 *
 * Writes beside the input unless `-o` says otherwise; never touches `latest.html`, which belongs
 * to the last run.
 */

const REPORT_DIR = "eval/results";

/** Timestamped reports, newest first. `latest.json` is a copy of one of these, so it's excluded. */
function savedReports(): string[] {
  if (!existsSync(REPORT_DIR)) return [];
  return readdirSync(REPORT_DIR)
    .filter((f) => f.startsWith("report-") && f.endsWith(".json"))
    .sort()
    .reverse()
    .map((f) => join(REPORT_DIR, f));
}

function summarize(path: string): string {
  try {
    const { meta } = JSON.parse(readFileSync(path, "utf-8")) as ReportFile;
    const when = new Date(meta.timestamp).toISOString().replace("T", " ").slice(0, 16);
    return `${when}  ${meta.model}  ${meta.passed}/${meta.graded} passed${
      meta.mode === "fast" ? "  [fast]" : ""
    }`;
  } catch {
    return "(unreadable)";
  }
}

function list(): void {
  const reports = savedReports();
  if (reports.length === 0) {
    console.error(`No reports in ${REPORT_DIR}. Run \`pnpm eval\` first.`);
    process.exit(1);
  }
  console.log(`\n${reports.length} report(s) in ${REPORT_DIR}:\n`);
  for (const p of reports) console.log(`  ${basename(p)}\n    ${summarize(p)}`);
  console.log();
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes("--list") || args.includes("-l")) return list();

  const outFlag = args.indexOf("-o");
  const explicitOut = outFlag !== -1 ? args[outFlag + 1] : undefined;
  // `outFlag + 1` is 0 when there is no `-o`, which would silently drop the first argument —
  // the path the user actually asked for. Guard the index rather than computing it.
  const outValueAt = outFlag === -1 ? -1 : outFlag + 1;
  const positional = args.filter((a, i) => !a.startsWith("-") && i !== outValueAt);

  const input = positional[0] ?? savedReports()[0];
  if (!input) {
    console.error(`No reports in ${REPORT_DIR}. Run \`pnpm eval\` first.`);
    process.exit(1);
  }
  if (!existsSync(input)) {
    console.error(`\n"${input}" does not exist. \`pnpm eval:render --list\` shows what does.\n`);
    process.exit(1);
  }

  let report: ReportFile;
  try {
    report = JSON.parse(readFileSync(input, "utf-8")) as ReportFile;
  } catch (err) {
    console.error(`\n"${input}" is not valid JSON: ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  }
  // Caught here rather than deep inside the renderer.
  if (!report?.meta || !Array.isArray(report.cases)) {
    console.error(`\n"${input}" is not an eval report (no meta/cases).\n`);
    process.exit(1);
  }

  const out = explicitOut ?? join(dirname(input), `${basename(input).replace(/\.json$/, "")}.html`);
  writeFileSync(out, renderHtml(report));
  console.log(`\n  ${summarize(input)}\n  → ${resolve(out)}\n`);
}

main();
