import { HumanMessage, isAIMessage, isToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DATABASE, LIMITS } from "../config.mts";
import { prepareDatabase } from "../db.mts";
import { seed } from "../seed.mts";
import type { RunCapture } from "../types.mts";
import { CORE_SERVER_COUNT, MAX_SCALE, worldAt, type BenchWorld } from "./servers.mts";
import { tasks, type BenchTask } from "./tasks.mts";

/**
 * MCP disclosure benchmark: the same tasks with every MCP tool bound up front ("bind-all") and
 * with progressive disclosure, as the number of servers grows. It MEASURES — tokens, cached
 * tokens, model steps, tool choice — and gates nothing. Paid and slow; never part of `pnpm eval`.
 *
 *   pnpm bench:mcp                      every scale the snapshots allow, both arms
 *   BENCH_SCALES=3,5 BENCH_REPEATS=1 pnpm bench:mcp bank-balance
 *   BENCH_COLD=1 pnpm bench:mcp         no prompt-cache hit across conversations
 */

type Arm = "bind-all" | "disclosure";

const MODEL = {
  provider: process.env.EVAL_PROVIDER ?? "openai-compatible",
  name: process.env.EVAL_MODEL ?? "muse-spark-1.3-contributor",
  baseUrl: process.env.EVAL_BASE_URL ?? null,
};

const DEFAULT_SCALES = [3, 5, 10, 20];
const SCALES = process.env.BENCH_SCALES
  ? process.env.BENCH_SCALES.split(",").map(Number)
  : DEFAULT_SCALES.filter((s) => s <= MAX_SCALE);
const ARMS = (process.env.BENCH_ARMS?.split(",") as Arm[] | undefined) ?? [
  "bind-all",
  "disclosure",
];
const REPEATS = Number(process.env.BENCH_REPEATS ?? 5);
/** Cold cache: every conversation starts with a prefix the provider has never seen. */
const COLD = process.env.BENCH_COLD === "1";

/** One key per arm, so the provider's dashboard splits the two. Falls back to the usual key. */
const ARM_KEY: Record<Arm, string | undefined> = {
  "bind-all": process.env.BENCH_KEY_BIND_ALL,
  disclosure: process.env.BENCH_KEY_DISCLOSURE,
};

interface StepUsage {
  input: number;
  output: number;
  /** Input tokens served from the provider's prompt cache; null when the provider didn't say. */
  cacheRead: number | null;
}

interface BenchRun {
  seq: number;
  scale: number;
  arm: Arm;
  task: string;
  group: string;
  repeat: number;
  ms: number;
  steps: StepUsage[];
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number | null;
  trajectory: string[];
  toolsCorrect: boolean;
  answerCorrect: boolean;
  /** Calls to a distractor server's tool. */
  wrongMcpCalls: number;
  loadToolsCalls: number;
  toolsLoaded: number;
  finalText: string;
  error?: string;
}

type Agent = { invoke: (input: unknown, config: unknown) => Promise<{ messages: BaseMessage[] }> };

function flatten(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is { type: string; text: string } => (b as { type?: string })?.type === "text")
    .map((b) => b.text)
    .join("");
}

function usageOf(m: BaseMessage): StepUsage | null {
  const u = (m as { usage_metadata?: Record<string, unknown> }).usage_metadata;
  if (!u) return null;
  const details = u.input_token_details as { cache_read?: number } | undefined;
  // Fallback: the raw OpenAI-style usage block, for endpoints LangChain doesn't map.
  const raw = (m.response_metadata as { usage?: Record<string, unknown> } | undefined)?.usage;
  const rawCached = (raw?.prompt_tokens_details as { cached_tokens?: number } | undefined)
    ?.cached_tokens;
  return {
    input: Number(u.input_tokens ?? 0),
    output: Number(u.output_tokens ?? 0),
    cacheRead: details?.cache_read ?? rawCached ?? null,
  };
}

async function runTask(agent: Agent, task: BenchTask) {
  const config = {
    configurable: { thread_id: `bench-${randomUUID()}` },
    recursionLimit: LIMITS.recursionLimit,
  };
  let messages: BaseMessage[] = [];
  for (const turn of task.turns) {
    const result = await agent.invoke(
      { messages: [new HumanMessage(turn)] },
      { ...config, signal: AbortSignal.timeout(LIMITS.timeoutMs) },
    );
    messages = result.messages;
  }

  const capture: RunCapture = { finalText: "", trajectory: [], toolResults: [], interrupts: [] };
  const steps: StepUsage[] = [];
  for (const m of messages) {
    if (isAIMessage(m)) {
      for (const tc of m.tool_calls ?? [])
        capture.trajectory.push({ name: tc.name, args: tc.args });
      const usage = usageOf(m);
      if (usage) steps.push(usage);
      const text = flatten(m.content);
      if (text.trim()) capture.finalText = text;
    }
    if (isToolMessage(m)) {
      capture.toolResults.push({ name: m.name ?? "unknown", content: flatten(m.content) });
    }
  }
  return { capture, steps };
}

async function passes(graders: BenchTask["tools"], capture: RunCapture): Promise<boolean> {
  const results = await Promise.all(graders.map((g) => g.grade(capture)));
  return results.every((r) => r.passed);
}

function toolsLoaded(capture: RunCapture): number {
  let n = 0;
  for (const r of capture.toolResults) {
    if (r.name !== "load_tools") continue;
    try {
      n += (JSON.parse(r.content) as { loaded?: unknown[] }).loaded?.length ?? 0;
    } catch {
      // Not JSON: nothing was loaded.
    }
  }
  return n;
}

async function measure(
  getAgent: (cfg: unknown) => Promise<unknown>,
  world: BenchWorld,
  arm: Arm,
  task: BenchTask,
  basePrompt: string,
): Promise<Omit<BenchRun, "seq" | "scale" | "arm" | "task" | "group" | "repeat">> {
  const key = ARM_KEY[arm];
  if (key) process.env.OPENAI_COMPATIBLE_API_KEY = key;

  // Bind-all: every tool passed straight to the agent, and no servers, so the middleware adds
  // neither `load_tools` nor the capability list. Disclosure: the agent as it ships.
  const never = async () => ({ ok: false as const, error: "connect_failed", message: "unused" });
  const agent = (await getAgent({
    provider: MODEL.provider,
    model: MODEL.name,
    baseUrl: MODEL.baseUrl,
    bypassApprovalForEval: true,
    // A nonce first in the prompt, so nothing sent before can be reused.
    ...(COLD
      ? {
          systemPrompt: `[conversation ${randomUUID()}]
${basePrompt}`,
        }
      : {}),
    ...(arm === "bind-all"
      ? { tools: world.tools, mcpForEval: { servers: [], resolveTool: never } }
      : { mcpForEval: { servers: world.servers, resolveTool: world.resolveTool } }),
  })) as Agent;

  const t0 = Date.now();
  try {
    const { capture, steps } = await runTask(agent, task);
    const cached = steps.map((s) => s.cacheRead);
    return {
      ms: Date.now() - t0,
      steps,
      inputTokens: steps.reduce((n, s) => n + s.input, 0),
      outputTokens: steps.reduce((n, s) => n + s.output, 0),
      cachedTokens: cached.every((c) => c === null)
        ? null
        : cached.reduce<number>((n, c) => n + (c ?? 0), 0),
      trajectory: capture.trajectory.map((t) => t.name),
      toolsCorrect: await passes(task.tools, capture),
      answerCorrect: await passes(task.answer, capture),
      wrongMcpCalls: capture.trajectory.filter((t) => world.distractorToolNames.has(t.name)).length,
      loadToolsCalls: capture.trajectory.filter((t) => t.name === "load_tools").length,
      toolsLoaded: toolsLoaded(capture),
      finalText: capture.finalText,
    };
  } catch (err) {
    return {
      ms: Date.now() - t0,
      steps: [],
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: null,
      trajectory: [],
      toolsCorrect: false,
      answerCorrect: false,
      wrongMcpCalls: 0,
      loadToolsCalls: 0,
      toolsLoaded: 0,
      finalText: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (xs: boolean[]) => `${Math.round(mean(xs.map(Number)) * 100)}%`;

function summarize(runs: BenchRun[]) {
  const rows: Record<string, string | number>[] = [];
  for (const scale of SCALES) {
    for (const arm of ARMS) {
      const cell = runs.filter(
        (r) => r.scale === scale && r.arm === arm && !r.error && r.group !== "thread",
      );
      if (cell.length === 0) continue;
      const cached = cell.filter((r) => r.cachedTokens !== null);
      rows.push({
        servers: scale,
        arm,
        runs: cell.length,
        "input tok": Math.round(mean(cell.map((r) => r.inputTokens))),
        "cached tok": cached.length ? Math.round(mean(cached.map((r) => r.cachedTokens!))) : "n/a",
        steps: mean(cell.map((r) => r.steps.length)).toFixed(1),
        "right tools": pct(cell.map((r) => r.toolsCorrect)),
        "right answer": pct(cell.map((r) => r.answerCorrect)),
        "wrong MCP calls": mean(cell.map((r) => r.wrongMcpCalls)).toFixed(2),
      });
    }
  }
  return rows;
}

const CSV_COLUMNS = [
  "seq",
  "scale",
  "arm",
  "task",
  "group",
  "repeat",
  "ms",
  "modelSteps",
  "inputTokens",
  "outputTokens",
  "cachedTokens",
  "firstStepInput",
  "firstStepCached",
  "toolsCorrect",
  "answerCorrect",
  "wrongMcpCalls",
  "loadToolsCalls",
  "toolsLoaded",
  "error",
] as const;

function toCsv(runs: BenchRun[]): string {
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = runs.map((r) =>
    [
      r.seq,
      r.scale,
      r.arm,
      r.task,
      r.group,
      r.repeat,
      r.ms,
      r.steps.length,
      r.inputTokens,
      r.outputTokens,
      r.cachedTokens,
      r.steps[0]?.input,
      r.steps[0]?.cacheRead,
      r.toolsCorrect,
      r.answerCorrect,
      r.wrongMcpCalls,
      r.loadToolsCalls,
      r.toolsLoaded,
      r.error,
    ]
      .map(cell)
      .join(","),
  );
  return [CSV_COLUMNS.join(","), ...lines].join("\n");
}

async function closePools(): Promise<void> {
  try {
    const { postgresCheckpointer } = await import("../../src/lib/agent/memory.ts");
    await (postgresCheckpointer as unknown as { end?: () => Promise<void> }).end?.();
  } catch {
    // Never ran / already closed.
  }
  try {
    await (globalThis as { pool?: { end?: () => Promise<void> } }).pool?.end?.();
  } catch {
    // Never ran / already closed.
  }
}

async function main() {
  const only = process.argv.slice(2).find((a) => !a.startsWith("-"));
  const selected = only ? tasks.filter((t) => t.id.includes(only) || t.group === only) : tasks;

  if (MODEL.provider === "openai-compatible" && !MODEL.baseUrl) {
    console.error("\nSet EVAL_BASE_URL to the model endpoint (it is not stored in the repo).\n");
    process.exit(1);
  }
  if (selected.length === 0) {
    console.error(`No task matches "${only}". ids: ${tasks.map((t) => t.id).join(", ")}`);
    process.exit(1);
  }
  const tooLarge = SCALES.filter((s) => s > MAX_SCALE || s < CORE_SERVER_COUNT);
  if (tooLarge.length) {
    console.error(
      `\nScale(s) ${tooLarge.join(", ")} need more server snapshots: eval/bench/snapshots holds ` +
        `enough for ${MAX_SCALE} servers. Add some with \`pnpm bench:mcp:export\`.\n`,
    );
    process.exit(1);
  }

  console.log(`\nMCP disclosure benchmark — ${MODEL.provider} / ${MODEL.name}`);
  console.log(
    `  scales ${SCALES.join(", ")} · arms ${ARMS.join(", ")} · ${REPEATS} repeat(s)` +
      (COLD ? " · cold cache" : ""),
  );

  // Every task only reads, so the fixture is seeded once.
  await prepareDatabase();
  await seed(DATABASE.url);
  process.env.DATABASE_URL = DATABASE.url;
  const { getAgent } = await import("../../src/lib/agent/index.ts");
  const { buildSystemPrompt } = await import("../../src/lib/agent/prompt.ts");
  const { listSkills } = await import("../../src/lib/skills/registry.ts");
  const basePrompt = buildSystemPrompt(listSkills());

  const worlds = SCALES.map(worldAt);
  const runs: BenchRun[] = [];
  const startedAt = new Date().toISOString();
  // Each run is saved as it finishes, so a crash hours in loses nothing.
  const resultsDir = join(dirname(fileURLToPath(import.meta.url)), "results");
  mkdirSync(resultsDir, { recursive: true });
  const partial = join(resultsDir, `running-${startedAt.replace(/[:.]/g, "-")}.jsonl`);
  try {
    for (const world of worlds) {
      console.log(
        `\n  ${world.scale} servers · ${world.toolCount} tools · ~${world.schemaTokens} schema tokens`,
      );
      for (const arm of ARMS) {
        for (const task of selected) {
          if (task.onlyAtScale && task.onlyAtScale !== world.scale) continue;
          process.stdout.write(`    ${arm.padEnd(10)} ${task.id.padEnd(26)} `);
          for (let repeat = 1; repeat <= REPEATS; repeat++) {
            const result = await measure(getAgent as never, world, arm, task, basePrompt);
            runs.push({
              seq: runs.length + 1,
              scale: world.scale,
              arm,
              task: task.id,
              group: task.group,
              repeat,
              ...result,
            });
            appendFileSync(partial, `${JSON.stringify(runs[runs.length - 1])}\n`);
            process.stdout.write(
              result.error ? "x" : result.toolsCorrect && result.answerCorrect ? "•" : "o",
            );
          }
          console.log();
        }
      }
    }
  } finally {
    await closePools();
  }

  console.log();
  console.table(summarize(runs));
  const errors = runs.filter((r) => r.error);
  if (errors.length) console.log(`${errors.length} run(s) threw; first: ${errors[0].error}`);

  const dir = join(dirname(fileURLToPath(import.meta.url)), "results");
  mkdirSync(dir, { recursive: true });
  const report = {
    startedAt,
    model: { provider: MODEL.provider, name: MODEL.name },
    repeats: REPEATS,
    coldCache: COLD,
    scales: worlds.map((w) => ({
      servers: w.scale,
      tools: w.toolCount,
      schemaTokens: w.schemaTokens,
      serverNames: w.servers.map((s) => s.name),
    })),
    summary: summarize(runs),
    runs,
  };
  const stamp = startedAt.replace(/[:.]/g, "-");
  for (const name of [`bench-${stamp}`, "latest"]) {
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(report, null, 2));
    writeFileSync(join(dir, `${name}.csv`), toCsv(runs));
  }
  console.log(`  results: ${join(dir, "latest.json")}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
