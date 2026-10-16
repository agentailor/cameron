// OTel GenAI semantic conventions (Development stability) — the only place these names live.
// Verified against Phoenix 20.23 ingest; see docs/OBSERVABILITY.md before renaming any.

export const GEN_AI = {
  OPERATION_NAME: "gen_ai.operation.name",
  PROVIDER_NAME: "gen_ai.provider.name",
  AGENT_NAME: "gen_ai.agent.name",
  CONVERSATION_ID: "gen_ai.conversation.id",
  REQUEST_MODEL: "gen_ai.request.model",
  RESPONSE_MODEL: "gen_ai.response.model",
  RESPONSE_FINISH_REASONS: "gen_ai.response.finish_reasons",
  USAGE_INPUT_TOKENS: "gen_ai.usage.input_tokens",
  USAGE_OUTPUT_TOKENS: "gen_ai.usage.output_tokens",
  SYSTEM_INSTRUCTIONS: "gen_ai.system_instructions",
  INPUT_MESSAGES: "gen_ai.input.messages",
  OUTPUT_MESSAGES: "gen_ai.output.messages",
  TOOL_NAME: "gen_ai.tool.name",
  TOOL_CALL_ID: "gen_ai.tool.call.id",
  TOOL_TYPE: "gen_ai.tool.type",
  TOOL_CALL_ARGUMENTS: "gen_ai.tool.call.arguments",
  TOOL_CALL_RESULT: "gen_ai.tool.call.result",
} as const;

export const OPERATION = {
  INVOKE_AGENT: "invoke_agent",
  CHAT: "chat",
  EXECUTE_TOOL: "execute_tool",
} as const;

export const ERROR_TYPE = "error.type";

export const CAMERON = {
  RUN_RESUMED: "cameron.run.resumed",
  APPROVALS_APPROVED: "cameron.approval.approved",
  APPROVALS_REJECTED: "cameron.approval.rejected",
  TOOL_MUTATING: "cameron.tool.mutating",
  SPAN_UNFINISHED: "cameron.span.unfinished",
  APPROVAL_REQUESTED_EVENT: "cameron.approval.requested",
  APPROVAL_TOOLS: "cameron.approval.tools",
} as const;

export const AGENT_NAME = "cameron";

const PROVIDER_NAMES: Record<string, string> = {
  google_genai: "gcp.gemini",
  google_vertexai: "gcp.vertex_ai",
};

/** LangChain's `ls_provider` → the semconv `gen_ai.provider.name` value. */
export function toProviderName(lsProvider: string): string {
  return PROVIDER_NAMES[lsProvider] ?? lsProvider;
}
