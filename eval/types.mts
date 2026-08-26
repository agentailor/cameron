/**
 * Core eval types. Deliberately depends on no eval library — graders are plain functions, so
 * swapping in a library later means writing adapters that satisfy `Grader`, not a rewrite.
 */

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  name: string;
  content: string;
}

/** Everything one run of a case produced. */
export interface RunCapture {
  finalText: string;
  trajectory: ToolCall[];
  toolResults: ToolResult[];
  /**
   * Tool calls the approval gate PAUSED before running. Empty unless the case set `approval`.
   * The only evidence a mutation was gated rather than executed — `trajectory` looks identical
   * either way.
   */
  interrupts: ToolCall[];
  /** Set if invoke threw — a crash is a graded failure, not a harness failure. */
  error?: string;
}

export interface GradeResult {
  graderId: string;
  passed: boolean;
  reason?: string;
}

export interface Grader {
  id: string;
  /** May be async: `rowCountInStore` reads the sandbox database back. */
  grade: (capture: RunCapture) => GradeResult | Promise<GradeResult>;
}

export interface EvalCase {
  id: string;
  description?: string;
  /**
   * The user turn(s), replayed in order on one thread. A string is a single turn; an array is a
   * conversation — needed whenever the behavior under test is the agent stopping to ask, since a
   * single turn cannot express the user's answer.
   */
  prompt: string | string[];
  graders: Grader[];
  /**
   * Run n times and require passK (pass@k). Omit for a single run — repeats are opt-in, and only
   * worth spending where behavior actually varies. See "Run policy" in eval/README.md.
   */
  runs?: { n: number; passK: number };
  /**
   * Run with the human-in-the-loop middleware LIVE and answer its interrupt with this decision.
   * Omit to auto-approve everything. Implies the case mutates, so the fixture is reset per run.
   */
  approval?: "allow" | "deny";
  /** Reported as skipped, never executed. Keeps a known-red case (and its reason) on the books. */
  skip?: boolean;
  /** Free-form labels for filtering/grouping. Not used by the runner. */
  tags?: string[];
}
