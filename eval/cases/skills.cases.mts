import { RUN_POLICY } from "../config.mts";
import {
  statesAmount,
  toolCalled,
  toolCalledBefore,
  toolCalledWith,
  toolNotCalled,
} from "../graders.mts";
import { FIXTURE } from "../seed.mts";
import type { EvalCase } from "../types.mts";

/**
 * Progressive disclosure: a capability the agent must choose to consult, and choose not to overuse.
 *
 * Nothing here is checkable without a model. A unit test proves `load_skill` returns the body and
 * `render_chart` refuses a bad spec, but not that the agent reaches for the skill at all, reads it
 * BEFORE acting, or leaves it alone when a sentence would do. Those are the ways a skill fails in
 * practice while every test stays green.
 */

const { dining } = FIXTURE;

export const cases: EvalCase[] = [
  {
    id: "chart-request-loads-skill",
    description: "An explicit chart request should consult the skill that covers charting.",
    prompt: "Show me a chart of my spending by category.",
    graders: [toolCalled("load_skill"), toolCalled("render_chart")],
    runs: RUN_POLICY.single,
    tags: ["skills", "charts"],
  },
  {
    id: "skill-read-before-charting",
    description:
      "The skill must be read BEFORE the chart is drawn. Loading it afterwards leaves an " +
      "identical set of tool calls but means the instructions never informed the work.",
    prompt: "Chart my spending by category for me.",
    graders: [
      toolCalledBefore("load_skill", "render_chart"),
      // Without this the order check passes on a run that charted nothing.
      toolCalled("render_chart"),
    ],
    // Repeats because activation is ~6/8 on claude-haiku-4-5 (3/3 on Sonnet): the model
    // sometimes charts without consulting the skill. Whether it loads varies; the ORDER never
    // has. A drop to 0-1 of 3 is the regression worth catching.
    runs: RUN_POLICY.majority,
    tags: ["skills", "charts", "ordering"],
  },
  {
    id: "trend-question-picks-line",
    description:
      "A measure over time is a line, not a bar — the one chart-selection judgment with a single " +
      "spelling, so it can be graded without a judge.",
    prompt: "Show me how my monthly spending has changed over the year.",
    graders: [
      toolCalledWith("render_chart", (a) => a.chartType === "line", "chartType=line"),
      toolNotCalled("query_transactions"),
    ],
    // Repeats because chart choice is model judgment, not mechanism — a wrong type here is a
    // plausible answer rather than a crash, so one green run would not show it is reliable.
    runs: RUN_POLICY.majority,
    tags: ["skills", "charts", "chart-selection"],
  },
  {
    id: "single-figure-needs-no-chart",
    description:
      "The over-triggering guard. Everything else in this file pushes toward charting; without " +
      "this, a prompt or skill edit that makes the agent chart single figures stays green.",
    prompt: `How much did I spend on ${dining.category} in total?`,
    graders: [
      toolNotCalled("render_chart"),
      // The positive half: a run that answered nothing must not pass the negative grader.
      toolCalled("run_sql"),
      statesAmount(dining.totalMajor),
    ],
    // Repeats because over-triggering is intermittent by nature: charting a single figure once in
    // three is still a regression, and a single run would miss it two times out of three.
    runs: RUN_POLICY.majority,
    tags: ["skills", "charts", "over-triggering-guard"],
  },
];
