import { describe, expect, it } from "vitest";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { Serialized } from "@langchain/core/load/serializable";
import { Command, GraphInterrupt } from "@langchain/langgraph";
import { SpanStatusCode } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { GenAiTracer } from "./genAiTracer";
import { toSemconvToolDefinitions } from "./messages";

const SERIALIZED = {} as Serialized;
const CONTENT_KEYS = [
  "gen_ai.input.messages",
  "gen_ai.output.messages",
  "gen_ai.system_instructions",
  "gen_ai.tool.call.arguments",
  "gen_ai.tool.call.result",
  "gen_ai.tool.definitions",
];

function setup(captureContent = false) {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const tracer = new GenAiTracer({ tracer: provider.getTracer("test"), captureContent });
  const spans = () => exporter.getFinishedSpans();
  const byName = (name: string) => spans().find((s) => s.name === name) as ReadableSpan;
  return { tracer, spans, byName };
}

const META = { ls_provider: "anthropic", ls_model_name: "claude-haiku-5-5", thread_id: "thread-1" };

function aiReply(fields: ConstructorParameters<typeof AIMessage>[0]) {
  return { generations: [[{ text: "", message: new AIMessage(fields) }]] };
}

function startRoot(t: GenAiTracer, inputs: Record<string, unknown> = { messages: [] }) {
  t.handleChainStart(SERIALIZED, inputs, "root", undefined, [], { thread_id: "thread-1" });
}

function chat(t: GenAiTracer, runId: string, parent: string, reply = aiReply({ content: "ok" })) {
  t.handleChatModelStart(
    SERIALIZED,
    [[new SystemMessage("You are Cameron."), new HumanMessage("What categories do I have?")]],
    runId,
    parent,
    { invocation_params: { model: "claude-haiku-5-5", tools: ANTHROPIC_TOOLS } },
    [],
    META,
  );
  t.handleLLMEnd(reply, runId);
}

function tool(t: GenAiTracer, runId: string, parent: string, name: string, output: unknown) {
  t.handleToolStart(SERIALIZED, '{"amount":12.5}', runId, parent, [], {}, name, `call-${runId}`);
  t.handleToolEnd(output, runId);
}

const BALANCE_SCHEMA = {
  type: "object",
  properties: { accountId: { type: "string" } },
  required: ["accountId"],
};
const BALANCE_DEFINITION = {
  type: "function",
  name: "bank__get_balance",
  description: "Current balance of one account.",
  parameters: BALANCE_SCHEMA,
};
// The shapes each provider's `invocation_params.tools` really has (captured from the SDKs).
const ANTHROPIC_TOOLS = [
  {
    name: "bank__get_balance",
    description: "Current balance of one account.",
    input_schema: BALANCE_SCHEMA,
  },
];
const OPENAI_TOOLS = [
  {
    type: "function",
    function: {
      name: "bank__get_balance",
      description: "Current balance of one account.",
      parameters: BALANCE_SCHEMA,
    },
  },
];
const GEMINI_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "bank__get_balance",
        description: "Current balance of one account.",
        parameters: BALANCE_SCHEMA,
      },
    ],
  },
];

const QUESTION = new HumanMessage("What categories do I have?");
const ANSWER = new AIMessage({
  content: "You have one category: Dining.",
  response_metadata: { finish_reason: "stop" },
});

function readRun(t: GenAiTracer) {
  startRoot(t, { messages: [QUESTION] });
  t.handleChainStart(SERIALIZED, {}, "node-model", "root");
  chat(
    t,
    "chat-1",
    "node-model",
    aiReply({
      content: "",
      tool_calls: [{ id: "call-tool-1", name: "list_categories", args: {} }],
      usage_metadata: { input_tokens: 12913, output_tokens: 163, total_tokens: 13076 },
      response_metadata: { finish_reason: "tool_use", model_name: "claude-haiku-5-5-20261001" },
    }),
  );
  t.handleChainEnd({}, "node-model");
  t.handleChainStart(SERIALIZED, {}, "node-tools", "root");
  tool(
    t,
    "tool-1",
    "node-tools",
    "list_categories",
    new ToolMessage({ content: '{"categories":["Dining"]}', tool_call_id: "call-tool-1" }),
  );
  t.handleChainEnd({}, "node-tools");
  t.handleChainEnd(
    {
      messages: [
        new HumanMessage("Earlier question"),
        new AIMessage("Earlier answer"),
        QUESTION,
        ANSWER,
      ],
    },
    "root",
  );
}

describe("GenAiTracer span tree", () => {
  it("emits one agent span with the model and tool spans as its direct children", () => {
    const { tracer, spans, byName } = setup();
    readRun(tracer);

    expect(
      spans()
        .map((s) => s.name)
        .sort(),
    ).toEqual(["chat claude-haiku-5-5", "execute_tool list_categories", "invoke_agent cameron"]);
    const root = byName("invoke_agent cameron");
    for (const name of ["chat claude-haiku-5-5", "execute_tool list_categories"]) {
      expect(byName(name).parentSpanContext?.spanId).toBe(root.spanContext().spanId);
      expect(byName(name).spanContext().traceId).toBe(root.spanContext().traceId);
    }
  });

  it("labels the agent span with the conversation and marks a fresh run as not resumed", () => {
    const { tracer, byName } = setup();
    readRun(tracer);

    expect(byName("invoke_agent cameron").attributes).toMatchObject({
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.agent.name": "cameron",
      "gen_ai.conversation.id": "thread-1",
      "cameron.run.resumed": false,
    });
  });

  it("records provider, models, token usage and finish reason on the model span", () => {
    const { tracer, byName } = setup();
    readRun(tracer);

    expect(byName("chat claude-haiku-5-5").attributes).toMatchObject({
      "gen_ai.operation.name": "chat",
      "gen_ai.provider.name": "anthropic",
      "gen_ai.request.model": "claude-haiku-5-5",
      "gen_ai.response.model": "claude-haiku-5-5-20261001",
      "gen_ai.usage.input_tokens": 12913,
      "gen_ai.usage.output_tokens": 163,
      "gen_ai.response.finish_reasons": ["tool_use"],
    });
  });

  it("omits token usage when the provider reports none", () => {
    const { tracer, byName } = setup();
    startRoot(tracer);
    chat(tracer, "chat-1", "root");
    tracer.handleChainEnd({}, "root");

    const attrs = byName("chat claude-haiku-5-5").attributes;
    expect(attrs).not.toHaveProperty("gen_ai.usage.input_tokens");
    expect(attrs).not.toHaveProperty("gen_ai.usage.output_tokens");
  });

  it("records cache reads and writes when the provider reports them", () => {
    const { tracer, byName } = setup();
    startRoot(tracer);
    chat(
      tracer,
      "chat-1",
      "root",
      aiReply({
        content: "",
        usage_metadata: {
          input_tokens: 1000,
          output_tokens: 10,
          total_tokens: 1010,
          input_token_details: { cache_read: 800, cache_creation: 150 },
        },
      }),
    );
    tracer.handleChainEnd({}, "root");

    expect(byName("chat claude-haiku-5-5").attributes).toMatchObject({
      "gen_ai.usage.cache_read.input_tokens": 800,
      "gen_ai.usage.cache_creation.input_tokens": 150,
    });
  });

  it("leaves cache attributes out when the provider reports no cache details", () => {
    const { tracer, byName } = setup();
    readRun(tracer);

    const attrs = byName("chat claude-haiku-5-5").attributes;
    expect(attrs).not.toHaveProperty("gen_ai.usage.cache_read.input_tokens");
    expect(attrs).not.toHaveProperty("gen_ai.usage.cache_creation.input_tokens");
  });

  it("maps LangChain's Google provider id to the semconv name", () => {
    const { tracer, spans } = setup();
    startRoot(tracer);
    tracer.handleChatModelStart(SERIALIZED, [[]], "chat-1", "root", {}, [], {
      ls_provider: "google_genai",
      ls_model_name: "gemini",
    });
    tracer.handleLLMEnd(aiReply({ content: "" }), "chat-1");
    tracer.handleChainEnd({}, "root");

    expect(spans().find((s) => s.name === "chat gemini")?.attributes["gen_ai.provider.name"]).toBe(
      "gcp.gemini",
    );
  });

  it("flags mutating tools so they can be told apart from reads", () => {
    const { tracer, byName } = setup();
    startRoot(tracer);
    tool(
      tracer,
      "t1",
      "root",
      "log_expense",
      new ToolMessage({ content: "{}", tool_call_id: "c1" }),
    );
    tool(
      tracer,
      "t2",
      "root",
      "list_categories",
      new ToolMessage({ content: "{}", tool_call_id: "c2" }),
    );
    tracer.handleChainEnd({}, "root");

    expect(byName("execute_tool log_expense").attributes).toMatchObject({
      "cameron.tool.mutating": true,
      "gen_ai.tool.call.id": "call-t1",
      "gen_ai.tool.type": "function",
    });
    expect(byName("execute_tool list_categories").attributes["cameron.tool.mutating"]).toBe(false);
  });
});

describe("GenAiTracer content capture", () => {
  it("sends no prompts, messages, arguments or results when capture is off", () => {
    const { tracer, spans } = setup(false);
    readRun(tracer);

    for (const span of spans()) {
      for (const key of CONTENT_KEYS) expect(span.attributes).not.toHaveProperty(key);
    }
  });

  it("sends semconv messages, system instructions, arguments and results when capture is on", () => {
    const { tracer, byName } = setup(true);
    readRun(tracer);

    const chatAttrs = byName("chat claude-haiku-5-5").attributes;
    expect(JSON.parse(chatAttrs["gen_ai.system_instructions"] as string)).toEqual([
      { type: "text", content: "You are Cameron." },
    ]);
    expect(JSON.parse(chatAttrs["gen_ai.tool.definitions"] as string)).toEqual([
      BALANCE_DEFINITION,
    ]);
    expect(JSON.parse(chatAttrs["gen_ai.input.messages"] as string)).toEqual([
      { role: "user", parts: [{ type: "text", content: "What categories do I have?" }] },
    ]);
    expect(JSON.parse(chatAttrs["gen_ai.output.messages"] as string)).toEqual([
      {
        role: "assistant",
        parts: [{ type: "tool_call", id: "call-tool-1", name: "list_categories", arguments: {} }],
        finish_reason: "tool_use",
      },
    ]);
    expect(byName("execute_tool list_categories").attributes).toMatchObject({
      "gen_ai.tool.call.arguments": '{"amount":12.5}',
      "gen_ai.tool.call.result": '{"categories":["Dining"]}',
    });
  });

  it("records the run's new messages and final answer on the agent span", () => {
    const { tracer, byName } = setup(true);
    readRun(tracer);

    const attrs = byName("invoke_agent cameron").attributes;
    expect(JSON.parse(attrs["gen_ai.input.messages"] as string)).toEqual([
      { role: "user", parts: [{ type: "text", content: "What categories do I have?" }] },
    ]);
    expect(JSON.parse(attrs["gen_ai.output.messages"] as string)).toEqual([
      {
        role: "assistant",
        parts: [{ type: "text", content: "You have one category: Dining." }],
        finish_reason: "stop",
      },
    ]);
  });

  it("records no input on a resumed run, whose input is a decision rather than a message", () => {
    const { tracer, byName } = setup(true);
    startRoot(tracer, new Command({ resume: { decisions: [{ type: "approve" }] } }) as never);
    tracer.handleChainEnd({ messages: [ANSWER] }, "root");

    const attrs = byName("invoke_agent cameron").attributes;
    expect(attrs).not.toHaveProperty("gen_ai.input.messages");
    expect(attrs).toHaveProperty("gen_ai.output.messages");
  });

  it("names non-text content blocks without inlining their data", () => {
    const { tracer, byName } = setup(true);
    startRoot(tracer);
    tracer.handleChatModelStart(
      SERIALIZED,
      [
        [
          new HumanMessage({
            content: [
              { type: "text", text: "Read this receipt" },
              { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
            ],
          }),
        ],
      ],
      "chat-1",
      "root",
      {},
      [],
      META,
    );
    tracer.handleLLMEnd(aiReply({ content: "" }), "chat-1");
    tracer.handleChainEnd({}, "root");

    const input = byName("chat claude-haiku-5-5").attributes["gen_ai.input.messages"] as string;
    expect(JSON.parse(input)[0].parts).toEqual([
      { type: "text", content: "Read this receipt" },
      { type: "image_url" },
    ]);
    expect(input).not.toContain("base64");
  });
});

describe("GenAiTracer approval gate", () => {
  function pause(t: GenAiTracer) {
    startRoot(t);
    t.handleChainStart(SERIALIZED, {}, "hitl", "root");
    t.handleChainError(
      new GraphInterrupt([
        {
          id: "i1",
          value: {
            actionRequests: [{ name: "log_expense", args: { amount: 12.5, note: "coffee" } }],
          },
        },
      ]),
      "hitl",
    );
    t.handleChainEnd({ messages: [] }, "root");
  }

  it("records the approval request on the agent span without arguments or an error", () => {
    const { tracer, byName } = setup(true);
    pause(tracer);

    const root = byName("invoke_agent cameron");
    expect(root.status.code).not.toBe(SpanStatusCode.ERROR);
    expect(root.events.map((e) => e.name)).toEqual(["cameron.approval.requested"]);
    expect(root.events[0].attributes).toEqual({ "cameron.approval.tools": ["log_expense"] });
    expect(JSON.stringify(root.events)).not.toContain("coffee");
  });

  it("marks a resumed run with its approve and reject counts", () => {
    const { tracer, byName } = setup();
    startRoot(
      tracer,
      new Command({
        resume: { decisions: [{ type: "approve" }, { type: "reject" }, { type: "reject" }] },
      }) as never,
    );
    tracer.handleChainEnd({}, "root");

    expect(byName("invoke_agent cameron").attributes).toMatchObject({
      "cameron.run.resumed": true,
      "cameron.approval.approved": 1,
      "cameron.approval.rejected": 2,
    });
  });
});

describe("GenAiTracer errors", () => {
  function failingTool(t: GenAiTracer) {
    startRoot(t);
    t.handleToolStart(SERIALIZED, "{}", "tool-1", "root", [], {}, "run_sql", "c1");
    t.handleToolError(new Error("amount 1234.56 is invalid"), "tool-1");
    t.handleChainEnd({}, "root");
  }

  it("marks a thrown tool error without its message when capture is off", () => {
    const { tracer, byName } = setup(false);
    failingTool(tracer);

    const span = byName("execute_tool run_sql");
    expect(span.status).toEqual({ code: SpanStatusCode.ERROR });
    expect(span.attributes["error.type"]).toBe("Error");
    expect(span.events).toEqual([]);
  });

  it("keeps the error message and exception when capture is on", () => {
    const { tracer, byName } = setup(true);
    failingTool(tracer);

    const span = byName("execute_tool run_sql");
    expect(span.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: "amount 1234.56 is invalid",
    });
    expect(span.events.map((e) => e.name)).toEqual(["exception"]);
  });

  it("marks a tool that returned an error message as failed", () => {
    const { tracer, byName } = setup();
    startRoot(tracer);
    tool(
      tracer,
      "t1",
      "root",
      "log_expense",
      new ToolMessage({ content: "boom", tool_call_id: "c1", status: "error" }),
    );
    tracer.handleChainEnd({}, "root");

    expect(byName("execute_tool log_expense").status.code).toBe(SpanStatusCode.ERROR);
    expect(byName("execute_tool log_expense").attributes["error.type"]).toBe("tool_error");
  });

  it("marks the agent span failed when the run itself throws", () => {
    const { tracer, byName } = setup();
    startRoot(tracer);
    tracer.handleChainError(new Error("recursion limit"), "root");

    expect(byName("invoke_agent cameron").status.code).toBe(SpanStatusCode.ERROR);
  });

  it("closes spans left open when the run ends and flags them unfinished", () => {
    const { tracer, spans, byName } = setup();
    startRoot(tracer);
    tracer.handleToolStart(SERIALIZED, "{}", "tool-1", "root", [], {}, "run_sql", "c1");
    tracer.handleChainError(new Error("aborted"), "root");

    expect(spans()).toHaveLength(2);
    expect(byName("execute_tool run_sql").attributes["cameron.span.unfinished"]).toBe(true);
  });
});

describe("toSemconvToolDefinitions", () => {
  it.each([
    ["OpenAI and OpenAI-compatible", OPENAI_TOOLS],
    ["Anthropic", ANTHROPIC_TOOLS],
    ["Gemini", GEMINI_TOOLS],
  ])("normalizes %s tools to the semconv shape", (_provider, tools) => {
    expect(toSemconvToolDefinitions(tools)).toEqual([BALANCE_DEFINITION]);
  });

  it("skips entries it cannot name, and anything that is not a list", () => {
    expect(toSemconvToolDefinitions([{ type: "web_search" }, ...OPENAI_TOOLS])).toEqual([
      BALANCE_DEFINITION,
    ]);
    expect(toSemconvToolDefinitions(undefined)).toEqual([]);
  });
});
