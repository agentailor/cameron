import type { Grader, RunCapture } from "./types.mts";

/** Deterministic graders — plain functions over a capture. No LLM, no library, no cost. */

function result(id: string, passed: boolean, reason?: string) {
  return { graderId: id, passed, reason };
}

/** Every named tool was called at least once. */
export function toolCalled(...names: string[]): Grader {
  const id = `toolCalled(${names.join(",")})`;
  return {
    id,
    grade: (c: RunCapture) => {
      const called = new Set(c.trajectory.map((t) => t.name));
      const missing = names.filter((n) => !called.has(n));
      return result(
        id,
        missing.length === 0,
        missing.length ? `never called: ${missing.join(", ")}` : undefined,
      );
    },
  };
}

/** A SQL-bearing tool call whose query matches `pattern` (e.g. an aggregate). */
export function sqlMatches(pattern: RegExp): Grader {
  const id = `sqlMatches(${pattern})`;
  return {
    id,
    grade: (c: RunCapture) => {
      const queries = c.trajectory
        .filter((t) => t.name === "run_sql")
        .map((t) => String(t.args.query ?? ""));
      if (queries.length === 0) return result(id, false, "run_sql was never called");
      const hit = queries.some((q) => pattern.test(q));
      return result(id, hit, hit ? undefined : `no run_sql query matched ${pattern}`);
    },
  };
}

/**
 * The final answer states the expected figure. Tolerates thousands separators so "$2,752.25"
 * and "2752.25" both count.
 */
export function statesAmount(expected: number): Grader {
  const id = `statesAmount(${expected})`;
  return {
    id,
    grade: (c: RunCapture) => {
      const normalized = c.finalText.replace(/,/g, "");
      const wanted = expected.toFixed(2);
      const found = normalized.includes(wanted);
      if (found) return result(id, true);
      // Surface what it DID say — for a wrong total that number is the whole finding.
      const numbers = [...normalized.matchAll(/\d+\.\d{2}/g)].map((m) => m[0]);
      return result(
        id,
        false,
        `expected ${wanted}; amounts in answer: ${numbers.length ? numbers.join(", ") : "none"}`,
      );
    },
  };
}

/** No amount other than the expected one is presented as a total. */
export function statesNoWrongTotal(expected: number): Grader {
  const id = `statesNoWrongTotal(${expected})`;
  return {
    id,
    grade: (c: RunCapture) => {
      const normalized = c.finalText.replace(/,/g, "");
      const wanted = expected.toFixed(2);
      // Only consider 4+ digit amounts — small figures are individual transactions, not totals.
      const bigAmounts = [...normalized.matchAll(/\d{4,}\.\d{2}/g)].map((m) => m[0]);
      const wrong = bigAmounts.filter((a) => a !== wanted);
      return result(
        id,
        wrong.length === 0,
        wrong.length ? `stated wrong total(s): ${[...new Set(wrong)].join(", ")}` : undefined,
      );
    },
  };
}
