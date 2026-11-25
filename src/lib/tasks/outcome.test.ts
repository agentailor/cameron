import { describe, expect, it } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import { makeTask } from "@agentailor/agent-tasks/testing";
import { outcomeOf, taskMessage, taskThreadTitle } from "./outcome";
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
