import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { Serialized } from "@langchain/core/load/serializable";
import { AIMessage, BaseMessage, ToolMessage } from "@langchain/core/messages";
import type { ChatGeneration, LLMResult } from "@langchain/core/outputs";
import type { ChainValues } from "@langchain/core/utils/types";
import { isGraphInterrupt } from "@langchain/langgraph";
import {
  context,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import { isMutatingTool } from "@/lib/agent/mutatingTools";
import { captureContent } from "./config";
import { toSemconvInput, toSemconvOutput } from "./messages";
import { AGENT_NAME, CAMERON, ERROR_TYPE, GEN_AI, OPERATION, toProviderName } from "./semconv";

type Metadata = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

// One agent run's callbacks → OTel GenAI spans (run, model calls, tool calls). One per request.
export class GenAiTracer extends BaseCallbackHandler {
  name = "cameron_genai_tracer";

  private readonly tracer: Tracer;
  private readonly capture: boolean;
  private readonly spans = new Map<string, Span>();
  private readonly parents = new Map<string, string | undefined>();
  private rootRunId: string | undefined;
  private approvalRecorded = false;

  constructor(opts: { tracer?: Tracer; captureContent?: boolean } = {}) {
    super();
    this.tracer = opts.tracer ?? trace.getTracer("cameron");
    this.capture = opts.captureContent ?? captureContent();
  }

  // LangChain calls this with (…, runId, parentRunId, tags, metadata), not the order its .d.ts declares.
  handleChainStart(
    _chain: Serialized,
    inputs: ChainValues,
    runId: string,
    parentRunId?: string,
    _tags?: string[],
    metadata?: Metadata,
  ) {
    this.parents.set(runId, parentRunId);
    if (parentRunId) return;

    this.rootRunId = runId;
    this.approvalRecorded = false;
    const conversationId = str(metadata?.thread_id);
    const span = this.tracer.startSpan(
      `${OPERATION.INVOKE_AGENT} ${AGENT_NAME}`,
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          [GEN_AI.OPERATION_NAME]: OPERATION.INVOKE_AGENT,
          [GEN_AI.AGENT_NAME]: AGENT_NAME,
          ...(conversationId ? { [GEN_AI.CONVERSATION_ID]: conversationId } : {}),
          ...resumeAttributes(inputs),
          ...(this.capture ? runInputAttributes(inputs) : {}),
        },
      },
      context.active(),
    );
    this.spans.set(runId, span);
  }

  handleChainEnd(outputs: ChainValues, runId: string) {
    if (runId !== this.rootRunId) return;
    const root = this.spans.get(runId);
    if (root && this.capture) root.setAttributes(runOutputAttributes(outputs));
    this.finishRoot();
  }

  handleChainError(err: Error, runId: string) {
    const interrupted = isGraphInterrupt(err);
    if (interrupted) this.recordApprovalRequest(err);
    if (runId !== this.rootRunId) return;
    const root = this.spans.get(runId);
    if (root && !interrupted) this.fail(root, err);
    this.finishRoot();
  }

  handleChatModelStart(
    _llm: Serialized,
    messages: BaseMessage[][],
    runId: string,
    parentRunId?: string,
    extraParams?: Metadata,
    _tags?: string[],
    metadata?: Metadata,
  ) {
    this.parents.set(runId, parentRunId);
    const invocation = (extraParams?.invocation_params ?? {}) as Metadata;
    const model = str(metadata?.ls_model_name) ?? str(invocation.model);
    const provider = str(metadata?.ls_provider);

    const attributes: Attributes = {
      [GEN_AI.OPERATION_NAME]: OPERATION.CHAT,
      ...(provider ? { [GEN_AI.PROVIDER_NAME]: toProviderName(provider) } : {}),
      ...(model ? { [GEN_AI.REQUEST_MODEL]: model } : {}),
    };
    if (this.capture) {
      const input = toSemconvInput(messages[0] ?? []);
      if (input.systemInstructions.length) {
        attributes[GEN_AI.SYSTEM_INSTRUCTIONS] = JSON.stringify(input.systemInstructions);
      }
      attributes[GEN_AI.INPUT_MESSAGES] = JSON.stringify(input.messages);
    }

    const name = model ? `${OPERATION.CHAT} ${model}` : OPERATION.CHAT;
    this.start(runId, parentRunId, name, SpanKind.CLIENT, attributes);
  }

  handleLLMEnd(output: LLMResult, runId: string) {
    const span = this.spans.get(runId);
    if (!span) return;
    const generation = output.generations?.[0]?.[0] as ChatGeneration | undefined;
    const message = generation?.message;
    const usage = (message as { usage_metadata?: Metadata } | undefined)?.usage_metadata;
    const meta = (message?.response_metadata ?? {}) as Metadata;
    const finishReason = finishReasonOf(message) ?? str(generation?.generationInfo?.finish_reason);
    const responseModel = str(meta.model_name) ?? str(meta.model);

    if (typeof usage?.input_tokens === "number") {
      span.setAttribute(GEN_AI.USAGE_INPUT_TOKENS, usage.input_tokens);
    }
    if (typeof usage?.output_tokens === "number") {
      span.setAttribute(GEN_AI.USAGE_OUTPUT_TOKENS, usage.output_tokens);
    }
    if (responseModel) span.setAttribute(GEN_AI.RESPONSE_MODEL, responseModel);
    if (finishReason) span.setAttribute(GEN_AI.RESPONSE_FINISH_REASONS, [finishReason]);
    if (this.capture && message) {
      span.setAttribute(
        GEN_AI.OUTPUT_MESSAGES,
        JSON.stringify(toSemconvOutput(message, finishReason)),
      );
    }
    this.end(runId);
  }

  handleLLMError(err: Error, runId: string) {
    const span = this.spans.get(runId);
    if (span) this.fail(span, err);
    this.end(runId);
  }

  handleToolStart(
    _tool: Serialized,
    input: string,
    runId: string,
    parentRunId?: string,
    _tags?: string[],
    _metadata?: Metadata,
    runName?: string,
    toolCallId?: string,
  ) {
    this.parents.set(runId, parentRunId);
    const toolName = runName ?? "unknown";
    const attributes: Attributes = {
      [GEN_AI.OPERATION_NAME]: OPERATION.EXECUTE_TOOL,
      [GEN_AI.TOOL_NAME]: toolName,
      [GEN_AI.TOOL_TYPE]: "function",
      [CAMERON.TOOL_MUTATING]: isMutatingTool(toolName),
      ...(toolCallId ? { [GEN_AI.TOOL_CALL_ID]: toolCallId } : {}),
      ...(this.capture ? { [GEN_AI.TOOL_CALL_ARGUMENTS]: input } : {}),
    };
    this.start(
      runId,
      parentRunId,
      `${OPERATION.EXECUTE_TOOL} ${toolName}`,
      SpanKind.INTERNAL,
      attributes,
    );
  }

  handleToolEnd(output: unknown, runId: string) {
    const span = this.spans.get(runId);
    if (!span) return;
    const message = ToolMessage.isInstance(output) ? output : undefined;
    if (message?.status === "error") {
      span.setAttribute(ERROR_TYPE, "tool_error");
      span.setStatus({ code: SpanStatusCode.ERROR });
    }
    if (this.capture)
      span.setAttribute(GEN_AI.TOOL_CALL_RESULT, toolResult(message?.content ?? output));
    this.end(runId);
  }

  handleToolError(err: Error, runId: string) {
    const span = this.spans.get(runId);
    if (isGraphInterrupt(err)) this.recordApprovalRequest(err);
    else if (span) this.fail(span, err);
    this.end(runId);
  }

  private start(
    runId: string,
    parentRunId: string | undefined,
    name: string,
    kind: SpanKind,
    attributes: Attributes,
  ) {
    const span = this.tracer.startSpan(name, { kind, attributes }, this.parentContext(parentRunId));
    this.spans.set(runId, span);
  }

  private end(runId: string) {
    this.spans.get(runId)?.end();
    this.spans.delete(runId);
  }

  // Graph nodes and middleware get no span, so walk up to the nearest run that has one.
  private parentContext(parentRunId: string | undefined): Context {
    for (let id = parentRunId; id; id = this.parents.get(id)) {
      const span = this.spans.get(id);
      if (span) return trace.setSpan(context.active(), span);
    }
    return context.active();
  }

  private fail(span: Span, err: Error) {
    span.setAttribute(ERROR_TYPE, err?.name || "Error");
    // An error message can quote a tool's arguments, so it is content too.
    span.setStatus({
      code: SpanStatusCode.ERROR,
      ...(this.capture ? { message: err?.message } : {}),
    });
    if (this.capture) span.recordException(err);
  }

  private recordApprovalRequest(err: unknown) {
    const root = this.rootRunId ? this.spans.get(this.rootRunId) : undefined;
    if (!root || this.approvalRecorded) return;
    const tools = ((err as { interrupts?: { value?: unknown }[] }).interrupts ?? []).flatMap(
      (i) => {
        const requests = (i.value as { actionRequests?: { name?: unknown }[] } | undefined)
          ?.actionRequests;
        return (requests ?? []).map((r) => String(r.name));
      },
    );
    if (tools.length === 0) return;
    this.approvalRecorded = true;
    root.addEvent(CAMERON.APPROVAL_REQUESTED_EVENT, { [CAMERON.APPROVAL_TOOLS]: tools });
  }

  private finishRoot() {
    const rootId = this.rootRunId;
    for (const [id, span] of this.spans) {
      if (id === rootId) continue;
      span.setAttribute(CAMERON.SPAN_UNFINISHED, true);
      span.end();
    }
    if (rootId) this.spans.get(rootId)?.end();
    this.spans.clear();
    this.parents.clear();
    this.rootRunId = undefined;
  }
}

function resumeAttributes(inputs: ChainValues): Attributes {
  const decisions = (inputs as { resume?: { decisions?: { type?: string }[] } } | undefined)?.resume
    ?.decisions;
  if (!Array.isArray(decisions)) return { [CAMERON.RUN_RESUMED]: false };
  return {
    [CAMERON.RUN_RESUMED]: true,
    [CAMERON.APPROVALS_APPROVED]: decisions.filter((d) => d?.type === "approve").length,
    [CAMERON.APPROVALS_REJECTED]: decisions.filter((d) => d?.type === "reject").length,
  };
}

const messagesOf = (values: ChainValues | undefined): BaseMessage[] =>
  Array.isArray(values?.messages)
    ? values.messages.filter((m: unknown) => BaseMessage.isInstance(m))
    : [];

// The turn's new messages; a resume carries a Command instead, so it has none.
function runInputAttributes(inputs: ChainValues): Attributes {
  const messages = messagesOf(inputs);
  if (messages.length === 0) return {};
  return { [GEN_AI.INPUT_MESSAGES]: JSON.stringify(toSemconvInput(messages).messages) };
}

// The output state holds the whole thread; the run's answer is its last AI message.
function runOutputAttributes(outputs: ChainValues): Attributes {
  const last = messagesOf(outputs).findLast((m) => AIMessage.isInstance(m));
  if (!last) return {};
  return { [GEN_AI.OUTPUT_MESSAGES]: JSON.stringify(toSemconvOutput(last, finishReasonOf(last))) };
}

function finishReasonOf(message: BaseMessage | undefined): string | undefined {
  const meta = (message?.response_metadata ?? {}) as Metadata;
  return str(meta.finish_reason) ?? str(meta.stop_reason);
}

function toolResult(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content);
}
