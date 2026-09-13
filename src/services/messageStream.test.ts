import { describe, expect, it } from "vitest";
import { ToolMessage } from "@langchain/core/messages";
import { streamMessages, type AgentRun } from "./messageStream";
import type { MessageResponse, ToolCall } from "@/types/message";

/**
 * Contract tests for the SSE chunk ordering. See docs/TESTING.md.
 *
 * Two things are asserted here because nothing else can observe them: a tool result must be
 * emitted when it RESOLVES, not when the run ends, and a requested-but-never-executed tool call
 * must be reported as pending approval. Both were regressions (#29) that typechecked fine.
 */

/** A deferred promise, so a test can decide exactly when the run settles. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function* fromArray<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

/** Never yields, and never ends until released — stands in for a stream still open. */
function openStream(release: Promise<unknown>): AsyncIterable<never> {
  return {
    async *[Symbol.asyncIterator]() {
      await release;
    },
  };
}

function aiMessage(text: string[], toolCalls?: ToolCall[]) {
  return { text: fromArray(text), output: Promise.resolve({ tool_calls: toolCalls }) };
}

function toolCall(name: string, callId: string, output: unknown = "ok") {
  return {
    name,
    callId,
    output: Promise.resolve(output),
    status: Promise.resolve("success"),
  };
}

async function collect(run: AgentRun): Promise<MessageResponse[]> {
  const out: MessageResponse[] = [];
  for await (const chunk of streamMessages(run)) out.push(chunk);
  return out;
}

describe("streamMessages ordering", () => {
  it("emits a tool result without waiting for the run to finish", async () => {
    // `output` stays pending until the test releases it. If the tool pump awaits it — the #29
    // bug — nothing is yielded and this test times out instead of failing slowly in production.
    const gate = deferred<unknown>();
    const run: AgentRun = {
      messages: fromArray([aiMessage(["thinking"])]),
      toolCalls: fromArray([toolCall("query_transactions", "call-1")]),
      values: fromArray([]),
      output: gate.promise,
    };

    const chunks: MessageResponse[] = [];
    const iterator = streamMessages(run)[Symbol.asyncIterator]();

    // Drain until the tool result appears, WITHOUT settling the run.
    for (let i = 0; i < 3; i++) {
      const next = await iterator.next();
      if (next.done) break;
      chunks.push(next.value);
      if (next.value.type === "tool") break;
    }

    const tool = chunks.find((c) => c.type === "tool");
    expect(tool).toBeDefined();
    expect(tool?.data).toMatchObject({ tool_call_id: "call-1", name: "query_transactions" });

    gate.resolve({ messages: [] });
    await iterator.next().catch(() => undefined);
  });

  it("does not wait on run.output for a tool that produces no artifact", async () => {
    // The run never settles. A correct pump still emits both tool results; the buggy one parks on
    // the first and this hangs.
    const never = new Promise<unknown>(() => {});
    const run: AgentRun = {
      messages: fromArray([aiMessage([])]),
      toolCalls: fromArray([toolCall("list_categories", "c1"), toolCall("run_sql", "c2")]),
      values: openStream(never),
      output: never,
    };

    const seen: string[] = [];
    const iterator = streamMessages(run)[Symbol.asyncIterator]();
    while (seen.length < 2) {
      const next = await iterator.next();
      if (next.done) break;
      if (next.value.type === "tool") seen.push((next.value.data as { name: string }).name);
    }

    expect(seen).toEqual(["list_categories", "run_sql"]);
  });

  it("keeps each tool result next to its call rather than batching them at the end", async () => {
    const run: AgentRun = {
      messages: fromArray([aiMessage(["step one"]), aiMessage(["step two"])]),
      toolCalls: fromArray([toolCall("load_skill", "s1")]),
      values: fromArray([]),
      output: Promise.resolve({ messages: [] }),
    };

    const chunks = await collect(run);
    const toolIndex = chunks.findIndex((c) => c.type === "tool");

    expect(toolIndex).toBeGreaterThanOrEqual(0);
    // The tool result must not be the final chunk when AI text follows it.
    expect(toolIndex).toBeLessThan(chunks.length - 1);
  });
});

describe("streamMessages pending approvals", () => {
  const call: ToolCall = {
    name: "log_expense",
    args: { amountMinor: 500 },
    id: "pending-1",
    type: "tool_call",
  };

  it("reports a requested call that never executed as pending", async () => {
    const run: AgentRun = {
      messages: fromArray([aiMessage(["logging that"], [call])]),
      // The gate paused before the tool ran, so the toolCalls stream yields nothing.
      toolCalls: fromArray([]),
      values: fromArray([]),
      output: Promise.resolve({ messages: [] }),
    };

    const chunks = await collect(run);
    const pending = chunks.find(
      (c) => (c.data as { pendingToolCallIds?: string[] }).pendingToolCallIds,
    );

    expect(pending).toBeDefined();
    expect((pending!.data as { pendingToolCallIds: string[] }).pendingToolCallIds).toEqual([
      "pending-1",
    ]);
  });

  it("reports nothing pending when the call did execute", async () => {
    const run: AgentRun = {
      messages: fromArray([aiMessage(["logging that"], [call])]),
      toolCalls: fromArray([toolCall("log_expense", "pending-1")]),
      values: fromArray([]),
      output: Promise.resolve({ messages: [] }),
    };

    const chunks = await collect(run);
    const pending = chunks.find(
      (c) => (c.data as { pendingToolCallIds?: string[] }).pendingToolCallIds,
    );

    // An auto-approved or already-approved call must never re-open the gate.
    expect(pending).toBeUndefined();
  });

  it("attributes pending ids to the AI message that requested them", async () => {
    const second: ToolCall = {
      name: "set_config",
      args: { key: "currency" },
      id: "pending-2",
      type: "tool_call",
    };
    const run: AgentRun = {
      messages: fromArray([aiMessage(["one"], [call]), aiMessage(["two"], [second])]),
      toolCalls: fromArray([toolCall("log_expense", "pending-1")]),
      values: fromArray([]),
      output: Promise.resolve({ messages: [] }),
    };

    const chunks = await collect(run);
    const pendings = chunks.filter(
      (c) => (c.data as { pendingToolCallIds?: string[] }).pendingToolCallIds,
    );

    // Only the un-executed call is pending, and it is reported once.
    expect(pendings).toHaveLength(1);
    expect((pendings[0].data as { pendingToolCallIds: string[] }).pendingToolCallIds).toEqual([
      "pending-2",
    ]);
  });
});

describe("streamMessages artifacts", () => {
  it("attaches an artifact collected from the values stream", async () => {
    const artifact = { chart: { rows: [{ x: 1 }] } };
    // A real ToolMessage — the collector filters on `ToolMessage.isInstance`, so a duck-typed
    // stand-in would pass the test while the production path skipped it.
    const snapshot = {
      messages: [
        new ToolMessage({
          content: "ok",
          tool_call_id: "chart-1",
          name: "render_chart",
          artifact,
        }),
      ],
    };

    const run: AgentRun = {
      messages: fromArray([aiMessage([])]),
      toolCalls: fromArray([toolCall("render_chart", "chart-1")]),
      values: fromArray([snapshot]),
      output: Promise.resolve(snapshot),
    };

    const chunks = await collect(run);
    const tool = chunks.find((c) => c.type === "tool");

    expect((tool?.data as { artifact?: unknown }).artifact).toEqual(artifact);
  });

  it("omits the artifact field for tools that produce none", async () => {
    const run: AgentRun = {
      messages: fromArray([aiMessage([])]),
      toolCalls: fromArray([toolCall("run_sql", "sql-1")]),
      values: fromArray([]),
      output: Promise.resolve({ messages: [] }),
    };

    const chunks = await collect(run);
    const tool = chunks.find((c) => c.type === "tool");

    expect(tool?.data).not.toHaveProperty("artifact");
  });
});
