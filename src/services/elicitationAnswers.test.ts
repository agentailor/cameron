import { describe, expect, it } from "vitest";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import {
  declineAll,
  readPendingElicitations,
  resolveElicitationAnswers,
  toElicitationResume,
} from "./elicitationAnswers";
import type { PendingElicitation } from "@/lib/mcp/elicitation";

const request = {
  mode: "form" as const,
  message: "Allow?",
  requestedSchema: {
    properties: { approval_choice: { type: "string", enum: ["ALLOW_ONCE", "DENY_ONCE"] } },
    required: ["approval_choice"],
  },
};

const asked = (args: Record<string, unknown>, id = "int-1") => ({
  id,
  value: {
    type: "mcp_elicitation",
    server: "mail",
    tool: "search_threads",
    arguments: args,
    requests: { approval_choice: request },
  },
});

const callsMessage = new AIMessage({
  content: "",
  tool_calls: [
    { id: "c1", name: "mail_search_threads", args: { query: "a" } },
    { id: "c2", name: "mail_search_threads", args: { query: "b" } },
  ],
});

describe("readPendingElicitations", () => {
  it("matches each request to its call by name and arguments", () => {
    const pending = readPendingElicitations(
      [asked({ query: "b" }, "int-b"), asked({ query: "a" }, "int-a")],
      [callsMessage],
    );
    expect(pending.map((p) => [p.interruptId, p.toolCallId])).toEqual([
      ["int-b", "c2"],
      ["int-a", "c1"],
    ]);
  });

  it("falls back to the first open call with that name when the arguments differ", () => {
    const pending = readPendingElicitations([asked({ query: "normalized" })], [callsMessage]);
    expect(pending[0].toolCallId).toBe("c1");
  });

  it("skips calls that already have a result", () => {
    const answered = new ToolMessage({ tool_call_id: "c1", content: "done", name: "x" });
    const pending = readPendingElicitations([asked({ query: "a" })], [callsMessage, answered]);
    expect(pending[0].toolCallId).toBe("c2");
  });

  it("ignores approval interrupts and payloads without an id", () => {
    const approval = { id: "hitl", value: { actionRequests: [] } };
    const noId = { value: asked({}).value };
    expect(readPendingElicitations([approval, noId], [callsMessage])).toEqual([]);
  });
});

const pending: PendingElicitation[] = [
  {
    interruptId: "int-1",
    toolCallId: "c1",
    server: "mail",
    tool: "search_threads",
    requests: { approval_choice: request },
  },
];

describe("resolveElicitationAnswers", () => {
  it("accepts: resumes the interrupt with the owner's content", () => {
    const answers = {
      "int-1": {
        approval_choice: { action: "accept" as const, content: { approval_choice: "ALLOW_ONCE" } },
      },
    };
    const resolved = resolveElicitationAnswers({ pending, answers });
    expect(resolved).toEqual({
      ok: true,
      resume: { "int-1": { responses: answers["int-1"] } },
      outcomes: { c1: "accept" },
    });
  });

  it("declines and cancels: resumes, and records the outcome for the note", () => {
    for (const action of ["decline", "cancel"] as const) {
      const resolved = resolveElicitationAnswers({
        pending,
        answers: { "int-1": { approval_choice: { action } } },
      });
      expect(resolved.ok && resolved.outcomes).toEqual({ c1: action });
    }
  });

  it("refuses when nothing is waiting, or an answer is missing, unknown or invalid", () => {
    const decline = { approval_choice: { action: "decline" as const } };
    expect(resolveElicitationAnswers({ pending: [], answers: { x: decline } })).toMatchObject({
      ok: false,
    });
    expect(resolveElicitationAnswers({ pending, answers: {} })).toMatchObject({ ok: false });
    expect(
      resolveElicitationAnswers({ pending, answers: { "int-1": decline, other: decline } }),
    ).toMatchObject({ ok: false });
    expect(
      resolveElicitationAnswers({
        pending,
        answers: { "int-1": { wrong_key: decline.approval_choice } },
      }),
    ).toMatchObject({ ok: false });
    expect(
      resolveElicitationAnswers({
        pending,
        answers: {
          "int-1": { approval_choice: { action: "accept", content: { approval_choice: "NO" } } },
        },
      }),
    ).toMatchObject({ ok: false });
  });
});

describe("with no one to answer", () => {
  it("declineAll declines every request of every interrupt, and resolves", () => {
    const answers = declineAll(pending);
    expect(answers).toEqual({ "int-1": { approval_choice: { action: "decline" } } });
    expect(resolveElicitationAnswers({ pending, answers }).ok).toBe(true);
  });

  it("builds a Command from this module's own langgraph", () => {
    expect(toElicitationResume({})).toBeInstanceOf(Command);
  });
});
