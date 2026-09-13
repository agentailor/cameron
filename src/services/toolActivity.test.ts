import { describe, expect, it } from "vitest";
import { buildThreadItems, type ToolActivityGroup } from "./toolActivity";
import { summarizeActivities } from "./toolSummary";
import type { MessageResponse, ToolCall } from "@/types/message";

/**
 * Contract tests for pairing tool calls with their results. See docs/TESTING.md.
 *
 * The wire delivers a call and its result as two separate messages, and a PAUSED call gets no
 * result at all. Pairing by adjacency would look right in the common case and break exactly where
 * it matters — on the approval gate.
 */

function ai(id: string, content: string, toolCalls?: ToolCall[]): MessageResponse {
  return { type: "ai", data: { id, content, ...(toolCalls ? { tool_calls: toolCalls } : {}) } };
}

function pendingAi(id: string, ids: string[]): MessageResponse {
  return { type: "ai", data: { id, content: "", pendingToolCallIds: ids } };
}

function call(name: string, id: string, args: Record<string, unknown> = {}): ToolCall {
  return { name, args, id, type: "tool_call" };
}

function toolResult(callId: string, name: string, content = '{"ok":true}'): MessageResponse {
  return {
    type: "tool",
    data: { id: callId, content, status: "success", tool_call_id: callId, name },
  };
}

const groups = (items: ReturnType<typeof buildThreadItems>) =>
  items.filter((i): i is ToolActivityGroup => i.kind === "tools");

describe("buildThreadItems", () => {
  it("pairs a call with its result into one activity", () => {
    const items = buildThreadItems([
      ai("a1", "", [call("run_sql", "c1")]),
      toolResult("c1", "run_sql", '{"rowCount":37}'),
    ]);

    const [group] = groups(items);
    expect(group.activities).toHaveLength(1);
    expect(group.activities[0]).toMatchObject({ callId: "c1", name: "run_sql", isPending: false });
    expect(group.activities[0].result).not.toBeNull();
  });

  it("never renders a result as its own item", () => {
    // The whole point of the refactor: one operation, one card.
    const items = buildThreadItems([
      ai("a1", "", [call("run_sql", "c1")]),
      toolResult("c1", "run_sql"),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("tools");
  });

  it("groups consecutive calls into one card", () => {
    const items = buildThreadItems([
      ai("a1", "", [call("describe_finance_schema", "c1")]),
      toolResult("c1", "describe_finance_schema"),
      ai("a2", "", [call("run_sql", "c2")]),
      toolResult("c2", "run_sql"),
      ai("a3", "", [call("render_chart", "c3")]),
      toolResult("c3", "render_chart"),
    ]);

    const g = groups(items);
    expect(g).toHaveLength(1);
    expect(g[0].activities.map((a) => a.name)).toEqual([
      "describe_finance_schema",
      "run_sql",
      "render_chart",
    ]);
  });

  it("starts a new group when the agent says something between calls", () => {
    const items = buildThreadItems([
      ai("a1", "", [call("run_sql", "c1")]),
      toolResult("c1", "run_sql"),
      ai("a2", "Here is what I found."),
      ai("a3", "", [call("render_chart", "c2")]),
      toolResult("c2", "render_chart"),
    ]);

    expect(groups(items)).toHaveLength(2);
    expect(items.map((i) => i.kind)).toEqual(["tools", "message", "tools"]);
  });

  it("marks a paused call pending and leaves its result null", () => {
    // A gated call has NO result message — pairing by adjacency would mis-assign the next one.
    const items = buildThreadItems([
      ai("a1", "", [call("log_expense", "c1", { amountMinor: 450 })]),
      pendingAi("a1", ["c1"]),
    ]);

    const [group] = groups(items);
    expect(group.activities[0]).toMatchObject({
      callId: "c1",
      isPending: true,
      isMutating: true,
      result: null,
    });
  });

  it("clears pending once the call has actually run", () => {
    const items = buildThreadItems([
      ai("a1", "", [call("log_expense", "c1")]),
      pendingAi("a1", ["c1"]),
      toolResult("c1", "log_expense"),
    ]);

    const [group] = groups(items);
    // A result settles it: approving must not leave the gate showing.
    expect(group.activities[0].isPending).toBe(false);
    expect(group.activities[0].result).not.toBeNull();
  });

  it("treats a call with no result yet as running, not pending", () => {
    const items = buildThreadItems([ai("a1", "", [call("run_sql", "c1")])]);
    const [group] = groups(items);
    expect(group.activities[0]).toMatchObject({ isPending: false, result: null });
  });

  it("keeps a result whose call never streamed rather than dropping it", () => {
    const items = buildThreadItems([toolResult("orphan", "run_sql")]);
    const [group] = groups(items);
    expect(group.activities[0]).toMatchObject({ callId: "orphan", name: "run_sql" });
  });

  it("renders human and error messages untouched", () => {
    const items = buildThreadItems([
      { type: "human", data: { id: "h1", content: "hi" } },
      { type: "error", data: { id: "e1", content: "boom" } },
    ]);
    expect(items.map((i) => i.kind)).toEqual(["message", "message"]);
  });

  it("drops an AI message that carries neither text nor calls", () => {
    const items = buildThreadItems([ai("a1", "")]);
    expect(items).toHaveLength(0);
  });

  it("keeps text and its own tool calls together in order", () => {
    const items = buildThreadItems([
      ai("a1", "Let me check.", [call("run_sql", "c1")]),
      toolResult("c1", "run_sql"),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["message", "tools"]);
  });

  it("deduplicates by type+id without dropping a distinct message", () => {
    // An AI message and a tool message can share an id; they are different namespaces.
    const items = buildThreadItems([
      ai("dup", "hello"),
      ai("dup", "hello"),
      { type: "human", data: { id: "dup", content: "hi" } },
    ]);
    expect(items).toHaveLength(2);
  });

  it("treats a replayed calls-only message as having no text", () => {
    // A reloaded thread stores content as an array whose blocks include `tool_call` entries.
    // Counting array length instead of extracting text would split the group and render an
    // empty bubble — verified against real /api/agent/history output.
    const replayed: MessageResponse = {
      type: "ai",
      data: {
        id: "a1",
        content: [{ type: "tool_call", name: "run_sql", args: {}, id: "c1" }] as never,
        tool_calls: [call("run_sql", "c1")],
      },
    };

    const items = buildThreadItems([replayed, toolResult("c1", "run_sql")]);
    expect(items.map((i) => i.kind)).toEqual(["tools"]);
  });

  it("keeps a replayed text+calls message as one message plus one group", () => {
    const replayed: MessageResponse = {
      type: "ai",
      data: {
        id: "a1",
        content: [
          { type: "text", text: "Let me check." },
          { type: "tool_call", name: "run_sql", args: {}, id: "c1" },
        ] as never,
        tool_calls: [call("run_sql", "c1")],
      },
    };

    const items = buildThreadItems([replayed, toolResult("c1", "run_sql")]);
    expect(items.map((i) => i.kind)).toEqual(["message", "tools"]);
  });
});

describe("summarizeActivities", () => {
  const activity = (over: Partial<Parameters<typeof summarizeActivities>[0][number]> = {}) => ({
    callId: "c1",
    name: "run_sql",
    args: {},
    result: toolResult("c1", "run_sql", '{"rowCount":37}'),
    isPending: false,
    isMutating: false,
    ...over,
  });

  it("gives a single call its own gist", () => {
    expect(summarizeActivities([activity()])).toBe("run_sql · 37 rows");
  });

  it("counts instead of guessing when several tools ran", () => {
    // No summary spans differently-shaped payloads, so counting is the only honest claim.
    expect(summarizeActivities([activity(), activity({ callId: "c2" })])).toBe("2 tools called");
  });

  it("names a single call with no readable gist", () => {
    expect(
      summarizeActivities([
        activity({ name: "load_skill", result: toolResult("c1", "load_skill", "plain text") }),
      ]),
    ).toBe("load_skill");
  });

  it("reports a pending call as awaiting approval", () => {
    expect(summarizeActivities([activity({ isPending: true, result: null })])).toBe(
      "awaiting approval",
    );
  });

  it("reports an unfinished call as running", () => {
    expect(summarizeActivities([activity({ result: null })])).toBe("running…");
  });

  it("says 'written' only for a tool that actually writes", () => {
    // `ok: true` is the same payload either way; only the tool says whether anything was written.
    expect(
      summarizeActivities([
        activity({ name: "log_expense", result: toolResult("c1", "log_expense", '{"ok":true}') }),
      ]),
    ).toBe("log_expense · written");
    expect(
      summarizeActivities([
        activity({ name: "load_skill", result: toolResult("c1", "load_skill", '{"ok":true}') }),
      ]),
    ).toBe("load_skill · ok");
  });
});
