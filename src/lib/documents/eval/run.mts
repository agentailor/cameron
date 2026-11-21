/**
 * Reader evals: read each fixture with a real model and grade the reading, field by field.
 * Paid and non-deterministic, like eval/ — never in CI, never in `pnpm test`.
 *
 *   pnpm eval:reader                      # every case, on the eval harness's model
 *   pnpm eval:reader de-receipt-decimal-comma ja-receipt-yen
 *
 * The model comes from eval/config.mts (EVAL_PROVIDER / EVAL_MODEL / EVAL_BASE_URL), so both
 * harnesses are pointed at a model the same way. See docs/DOCUMENTS.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL } from "../../../../eval/config.mts";
import type { GradeResult } from "../../../../eval/types.mts";
import { createChatModel } from "../../agent/models.ts";
import type { DocumentReading } from "../reading.ts";
import { readWithModel } from "../vision.ts";
import { CASES } from "./cases.mts";

const here = dirname(fileURLToPath(import.meta.url));
const only = process.argv.slice(2);
const cases = only.length ? CASES.filter((c) => only.includes(c.id)) : CASES;
const unknown = only.filter((id) => !CASES.some((c) => c.id === id));
if (unknown.length) {
  console.error(
    `Unknown case(s): ${unknown.join(", ")}. Cases: ${CASES.map((c) => c.id).join(", ")}`,
  );
  process.exit(2);
}

const model = createChatModel({
  provider: MODEL.provider,
  model: MODEL.name,
  baseUrl: MODEL.baseUrl,
});
const modelId = `${MODEL.provider}:${MODEL.name}`;
console.log(`Reader evals — ${modelId} — ${cases.length} case(s)\n`);

interface CaseResult {
  id: string;
  ms: number;
  reading?: DocumentReading;
  error?: string;
  results: GradeResult[];
}

const out: CaseResult[] = [];
for (const c of cases) {
  const started = Date.now();
  let entry: CaseResult;
  try {
    const { reading } = await readWithModel(model, {
      data: readFileSync(join(here, "fixtures", c.file)),
      mimeType: c.mimeType,
      filename: c.file,
    });
    entry = { id: c.id, ms: 0, reading, results: c.graders.map((g) => g.grade(reading)) };
  } catch (e) {
    const err = e as Error;
    const error = `${err.name}: ${err.message}`.slice(0, 300);
    entry = {
      id: c.id,
      ms: 0,
      error,
      results: [{ graderId: "read", passed: false, reason: error }],
    };
  }
  entry.ms = Date.now() - started;
  out.push(entry);

  const passed = entry.results.filter((r) => r.passed).length;
  const ok = passed === entry.results.length;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${c.id.padEnd(30)} ${passed}/${entry.results.length}  ${(entry.ms / 1000).toFixed(1)}s`,
  );
  for (const r of entry.results.filter((r) => !r.passed)) {
    console.log(`      ✗ ${r.graderId} — ${r.reason}`);
  }
}

const casesPassed = out.filter((c) => c.results.every((r) => r.passed)).length;
const graders = out.flatMap((c) => c.results);
console.log(
  `\n${casesPassed}/${out.length} cases passed, ${graders.filter((r) => r.passed).length}/${graders.length} checks`,
);

const resultsDir = join(here, "results");
mkdirSync(resultsDir, { recursive: true });
const stamp = new Date()
  .toISOString()
  .replace(/\.\d+Z$/, "")
  .replace(/:/g, "-");
const file = join(resultsDir, `${stamp}-${modelId.replace(/[^\w.-]+/g, "_")}.json`);
writeFileSync(
  file,
  JSON.stringify({ model: MODEL, ranAt: new Date().toISOString(), cases: out }, null, 2),
);
console.log(`Readings and verdicts: ${file}`);
process.exitCode = casesPassed === out.length ? 0 : 1;
