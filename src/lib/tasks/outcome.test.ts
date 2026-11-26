import { describe, expect, it } from "vitest";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { makeTask } from "@agentailor/agent-tasks/testing";
import {
  continuationOf,
  outcomeOf,
  permanentFailureOf,
  taskMessage,
  taskThreadTitle,
} from "./outcome";
import type { GraphSnapshot } from "@/services/approvalDecisions";

const pausedOn = (name: string): GraphSnapshot => ({
  tasks: [{ interrupts: [{ value: { actionRequests: [{ name, args: {} }], reviewConfigs: [] } }] }],
  values: {
    messages: [new AIMessage({ content: "", tool_calls: [{ id: "c1", name, args: {} }] })],
  },
});

describe("outcomeOf", () => {
  it("is paused for approval when the gate holds a call", () => {
    expect(outcomeOf(pausedOn("log_expense"))).toEqual({ status: "paused", reason: "approval" });
  });

  it("is paused, not done, on any other interrupt", () => {
    expect(outcomeOf({ tasks: [{ interrupts: [{ value: "something else" }] }] })).toEqual({
      status: "paused",
      reason: "interrupt",
    });
  });

  it("is done when nothing is pending", () => {
    expect(outcomeOf({ tasks: [], values: { messages: [new AIMessage("All set.")] } })).toEqual({
      status: "done",
    });
  });
});

describe("taskMessage", () => {
  it("tells the agent the owner is away, then gives the brief verbatim", () => {
    const message = taskMessage(makeTask({ brief: "Summarize last week." }));
    expect(message).toContain("weekly-digest");
    expect(message).toContain("not here");
    expect(message.endsWith("Summarize last week.")).toBe(true);
  });
});

describe("taskThreadTitle", () => {
  it("names the task and the slot's date", () => {
    const run = {
      id: "r",
      taskName: "weekly-digest",
      slot: new Date("2026-11-23T08:00:00Z"),
      trigger: "schedule" as const,
      status: "running" as const,
      startedAt: new Date(),
      attempts: 1,
    };
    expect(taskThreadTitle(makeTask(), run)).toBe("weekly-digest · 2026-11-23");
  });
});

describe("continuationOf", () => {
  const brief = new HumanMessage("Scheduled task: weekly-digest.");

  it("starts over when nothing was saved", () => {
    expect(continuationOf({ values: { messages: [] }, next: [] })).toBe("start");
    expect(continuationOf({})).toBe("start");
  });

  it("resumes when the graph stopped between steps", () => {
    expect(continuationOf({ values: { messages: [brief] }, next: ["model"] })).toBe("resume");
  });

  it("only records the outcome when it already finished or paused", () => {
    const done = { values: { messages: [brief, new AIMessage("Digest.")] }, next: [] };
    expect(continuationOf(done)).toBe("settled");
    expect(continuationOf({ ...pausedOn("log_expense"), next: ["tools"] })).toBe("settled");
  });
});

describe("permanentFailureOf", () => {
  const named = (name: string, message = name) => Object.assign(new Error(message), { name });

  it("returns running out of steps, and a missing model, as failures not worth retrying", () => {
    expect(permanentFailureOf(named("GraphRecursionError"))).toEqual({
      status: "failed",
      error: "Ran out of steps (limit 50).",
    });
    expect(permanentFailureOf(named("ModelNotConfiguredError", "No model."))).toEqual({
      status: "failed",
      error: "No model.",
    });
  });

  it("leaves everything else to be thrown, and retried", () => {
    expect(permanentFailureOf(new Error("429"))).toBeNull();
    expect(permanentFailureOf("not an error")).toBeNull();
  });
});
