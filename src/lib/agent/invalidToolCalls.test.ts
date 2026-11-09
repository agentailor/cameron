import { describe, expect, it, vi } from "vitest";
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { invalidToolCallMiddleware, MAX_INVALID_CALL_RETRIES } from "./invalidToolCalls";

const valid = (text = "done") => new AIMessage({ content: text });

const malformed = (extra: Partial<ConstructorParameters<typeof AIMessage>[0] & object> = {}) =>
  new AIMessage({
    content: "I'll pull all your notes now.",
    invalid_tool_calls: [
      {
        id: "bad-1",
        name: "notes_list_notes",
        args: "",
        error: "Failed to parse tool call arguments as JSON",
        type: "invalid_tool_call",
      },
    ],
    ...extra,
  });

type Request = { messages: BaseMessage[]; tools: { name: string }[] };
type Wrap = (request: Request, handler: (r: Request) => Promise<AIMessage>) => Promise<AIMessage>;

/** Runs the middleware's wrapModelCall against a scripted sequence of model responses. */
async function run(responses: AIMessage[], tools = ["notes_list_notes", "run_sql"]) {
  const wrap = invalidToolCallMiddleware().wrapModelCall as unknown as Wrap;
  const handler = vi.fn(async (_request: Request) => responses.shift()!);
  const request = {
    messages: [new HumanMessage("can you list all my notes")],
    tools: tools.map((name) => ({ name })),
  };
  const result = await wrap(request, handler);
  return { result, handler, request };
}

const resultsSentOn = (handler: ReturnType<typeof vi.fn>, call: number) =>
  (handler.mock.calls[call][0] as Request).messages
    .filter((m): m is ToolMessage => ToolMessage.isInstance(m))
    .map((m) => ({ id: m.tool_call_id, ...JSON.parse(String(m.content)) }));

describe("invalidToolCallMiddleware", () => {
  it("passes a well-formed response through with one model call", async () => {
    const { result, handler } = await run([valid()]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.content).toBe("done");
  });

  it("re-asks with the parse error, and keeps only the repaired response", async () => {
    const repaired = new AIMessage({
      content: "",
      tool_calls: [{ id: "good-1", name: "notes_list_notes", args: {}, type: "tool_call" }],
    });
    const { result, handler, request } = await run([malformed(), repaired]);

    expect(handler).toHaveBeenCalledTimes(2);
    const retry = (handler.mock.calls[1][0] as Request).messages;
    // The original messages, then the malformed step answered — never saved to the thread.
    expect(retry.slice(0, request.messages.length)).toEqual(request.messages);
    expect(retry.at(-2)).toMatchObject({
      tool_calls: [{ id: "bad-1", name: "notes_list_notes", args: {} }],
    });
    expect(resultsSentOn(handler, 1)).toEqual([
      expect.objectContaining({ id: "bad-1", ok: false, error: "invalid_arguments" }),
    ]);
    expect(result).toBe(repaired);
    expect(request.messages).toHaveLength(1);
  });

  it("finds a call that only appears as a v1 content block, and echoes back text only", async () => {
    // LangChain's v1 output format: the malformed call is a content block, the field is empty.
    const v1 = new AIMessage({
      content: [
        { type: "text", text: "I'll pull all your notes now." },
        {
          type: "invalid_tool_call",
          id: "bad-1",
          name: "notes_list_notes",
          args: "",
          error: "Failed to parse tool call arguments as JSON",
        },
      ] as unknown as string,
    });
    expect(v1.invalid_tool_calls ?? []).toEqual([]);
    const { handler } = await run([v1, valid()]);

    expect(handler).toHaveBeenCalledTimes(2);
    const echoed = (handler.mock.calls[1][0] as Request).messages.at(-2) as AIMessage;
    expect(echoed.content).toBe("I'll pull all your notes now.");
    expect(resultsSentOn(handler, 1)).toEqual([
      expect.objectContaining({ id: "bad-1", error: "invalid_arguments" }),
    ]);
  });

  it("says a tool isn't available when the model calls one it isn't offered", async () => {
    // A tool remembered from earlier in the thread whose server is gone: no schema, so no args.
    const { handler } = await run([malformed(), valid()], ["run_sql"]);
    expect(resultsSentOn(handler, 1)).toEqual([
      expect.objectContaining({ id: "bad-1", error: "unknown_tool" }),
    ]);
  });

  it("answers a valid sibling as not run, since the step is retried whole", async () => {
    const mixed = malformed({
      tool_calls: [{ id: "ok-1", name: "run_sql", args: { query: "select 1" }, type: "tool_call" }],
    });
    const { handler } = await run([mixed, valid()]);
    expect(resultsSentOn(handler, 1).map((r) => [r.id, r.error])).toEqual([
      ["ok-1", "not_run"],
      ["bad-1", "invalid_arguments"],
    ]);
  });

  it("gives up after the retry limit with a visible notice instead of a silent stop", async () => {
    const attempts = Array.from({ length: MAX_INVALID_CALL_RETRIES + 1 }, () => malformed());
    const { result, handler } = await run(attempts);
    expect(handler).toHaveBeenCalledTimes(MAX_INVALID_CALL_RETRIES + 1);
    expect(String(result.content)).toMatch(/^I'll pull all your notes now\.\n\n\(The call to/);
    expect(String(result.content)).toContain("notes_list_notes");
  });
});
