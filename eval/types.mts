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
  /**
   * The run produced no gradeable evidence, so graders are SKIPPED rather than run — a verdict on
   * a conversation that never happened is noise dressed as signal. Not a failure; see above.
   */
  inconclusive?: Inconclusive;
  /**
   * What was actually said, turn by turn. Only a simulated case fills this: a scripted case's
   * turns are already in `EvalCase.prompt`, and the report renders those.
   */
  conversation?: ConversationTurn[];
  /**
   * The graph was STILL PAUSED when the run ended — the agent was waiting on approval, not silent.
   * Lets a grader tell "never requested" from "requested and still waiting", which read the same
   * in `trajectory`.
   */
  pausedAtEnd?: boolean;
}

/**
 * Why a run produced no gradeable evidence.
 *
 * Deliberately a closed list. Every member is something the HARNESS or the CASE got wrong, never
 * something the agent got wrong — widening it is how this tier turns into a place to hide failures.
 */
export type InconclusiveReason =
  | "simulator-cannot-answer"
  | "simulator-invented"
  | "simulator-silent"
  | "max-turns"
  | "conversation-timeout";

export interface Inconclusive {
  reason: InconclusiveReason;
  /**
   * What to do about it. For `simulator-cannot-answer` this carries the agent's VERBATIM question,
   * because the repair is usually mechanical: add that fact to the case.
   */
  detail: string;
}

/** One thing said in a conversation, in order. */
export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
  /**
   * `fixed` came from the case's `prompt`; `simulated` was generated in response to the agent.
   * The distinction is the point — it separates "the case anticipated this" from "the user
   * answered a question the case never foresaw".
   */
  source?: "fixed" | "simulated";
}

/**
 * One thing the simulated user knows and will disclose if asked. Every value must be DERIVED from
 * FIXTURE, never typed by hand — see "The fact sheet" in eval/README.md.
 */
export interface UserFact {
  /** What the agent might ask about, in the agent's vocabulary: "date format", "which account". */
  topic: string;
  /** The answer. Atomic — the simulator RELAYS this, it does not compose or reason from it. */
  value: string;
  /**
   * Values that mean the simulator invented something. Worth setting only where a wrong answer
   * would silently invalidate a grader. Complements the `###CANNOT_ANSWER###` sentinel: that
   * catches an honest simulator declining, this catches a disobedient one answering anyway.
   */
  contradicts?: string[];
}

/**
 * Turns a case's user side from a recording into a participant, so the agent can ASK and get an
 * answer instead of failing on a question the case author didn't anticipate.
 *
 * Not a judge: the simulator produces INPUT, and every grader stays a deterministic function over
 * the capture. See "Simulated users" in eval/README.md.
 */
export interface SimulatedUser {
  /** One line of intent, first person. Becomes the persona's goal. */
  goal: string;
  /** The closed world the simulator may draw on. Anything else gets `###CANNOT_ANSWER###`. */
  facts: UserFact[];
  /**
   * Cap on TOTAL user turns, including the `prompt` prefix. Hitting it is `inconclusive`, never a
   * failure — the case never got to test what it tests. Defaults to DEFAULT_MAX_TURNS.
   */
  maxTurns?: number;
  /**
   * Ends the conversation early on a fact in the WORLD, not a phrase in the transcript — the same
   * "grade the consequence" stance the graders take. Effectively required on a mutating case: it
   * is what keeps cost bounded once the thing under test has happened.
   */
  until?: () => Promise<boolean>;
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
  /**
   * Opt into a simulated user, so the agent can ASK and get an answer.
   *
   * `prompt` stays the fixed opening; the simulator only takes over once those turns are spent. An
   * existing case therefore gains the ability to answer without changing what it asks first.
   * Omit for the blind replay every case had before.
   */
  user?: SimulatedUser;
  /**
   * Owner settings to establish BEFORE the run, written after the fixture reset.
   *
   * `config` is wiped between runs so a case about establishing a setting starts unanswered.
   * A case about REUSING one needs the opposite, and this is how it says so.
   */
  config?: Record<string, string>;
  /** Reported as skipped, never executed. Keeps a known-red case (and its reason) on the books. */
  skip?: boolean;
  /** Free-form labels for filtering/grouping. Not used by the runner. */
  tags?: string[];
}
