import { describe, expect, it } from "vitest";
import { ToolMessage } from "@langchain/core/messages";
import { ELICITATION_OUTCOMES_KEY, elicitationNoteMiddleware, withNote } from "./elicitationNotes";

type Wrap = (
  request: unknown,
  handler: (r: unknown) => Promise<ToolMessage>,
) => Promise<ToolMessage>;

const wrap = elicitationNoteMiddleware().wrapToolCall as unknown as Wrap;

const result = () =>
  new ToolMessage({
    tool_call_id: "c1",
    name: "mail_search",
    content: '{"resultCountEstimate":"13"}',
  });

const requestWith = (outcomes?: Record<string, string>) => ({
  toolCall: { id: "c1", name: "mail_search", args: {} },
  runtime: { configurable: outcomes ? { [ELICITATION_OUTCOMES_KEY]: outcomes } : {} },
});

describe("elicitationNoteMiddleware", () => {
  it("notes a declined call's result as possibly withheld", async () => {
    const out = await wrap(requestWith({ c1: "decline" }), async () => result());
    expect(out.content).toContain("declined");
    expect(out.content).toContain("does not mean nothing matched");
    expect(out.tool_call_id).toBe("c1");
  });

  it("notes a cancelled call too", async () => {
    const out = await wrap(requestWith({ c1: "cancel" }), async () => result());
    expect(out.content).toContain("dismissed");
  });

  it("leaves an accepted call and any other call alone", async () => {
    const accepted = await wrap(requestWith({ c1: "accept" }), async () => result());
    expect(accepted.content).toBe('{"resultCountEstimate":"13"}');
    const other = await wrap(requestWith({ c9: "decline" }), async () => result());
    expect(other.content).toBe('{"resultCountEstimate":"13"}');
    const none = await wrap(requestWith(), async () => result());
    expect(none.content).toBe('{"resultCountEstimate":"13"}');
  });

  it("lets the server's pause through untouched", async () => {
    const pause = new Error("interrupt");
    await expect(
      wrap(requestWith({ c1: "decline" }), async () => {
        throw pause;
      }),
    ).rejects.toBe(pause);
  });
});

describe("withNote", () => {
  it("adds a text block to block content", () => {
    const message = new ToolMessage({
      tool_call_id: "c1",
      content: [{ type: "text", text: "x" }],
    });
    expect(withNote(message, "n").content).toEqual([
      { type: "text", text: "x" },
      { type: "text", text: "[cameron] n" },
    ]);
  });
});
