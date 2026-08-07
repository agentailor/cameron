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
  grade: (capture: RunCapture) => GradeResult;
}

export interface EvalCase {
  id: string;
  description?: string;
  prompt: string;
  graders: Grader[];
  /**
   * Agents are non-deterministic: the same prompt can pass once and fail the next time. Run n
   * times and require passK. Omit for a single run.
   */
  runs?: { n: number; passK: number };
}
