import type {
  ElicitationAnswers,
  ElicitationResponses,
  PendingElicitation,
} from "@/lib/mcp/elicitation";

export interface Thread {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FileAttachment {
  url: string;
  key: string;
  name: string;
  type: string;
  size: number;
}

/** One human decision on one gated tool call. */
export type ApprovalDecision = "allow" | "deny";

export interface MessageOptions {
  model?: string;
  provider?: string;
  tools?: string[];
  /** Resume a paused batch: one decision per pending tool call, keyed by call id. */
  decisions?: Record<string, ApprovalDecision>;
  /** Resume a call a server paused with a question: answers keyed by interrupt id. */
  answers?: ElicitationAnswers;
  attachments?: FileAttachment[];
  /** Client-only: send into this thread instead of the hook's current one. Never serialized. */
  targetThreadId?: string;
}

export interface MessageRequest {
  threadId: string;
  type: "human";
  content: string;
  model?: string;
  tools?: string[];
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  id: string;
  type: "tool_call";
}

export interface ToolCallChunk {
  name: string;
  args: string;
  index: number;
  type: "tool_call_chunk";
  id: string;
}

export interface FunctionCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ContentItem {
  text?: string;
  functionCall?: FunctionCall;
  thoughtSignature?: string;
}

export interface AIMessageData {
  id: string;
  content: string | ContentItem[];
  tool_calls?: ToolCall[];
  tool_call_chunks?: ToolCallChunk[];
  additional_kwargs?: Record<string, unknown>;
  invalid_tool_calls?: unknown[];
  response_metadata?: Record<string, unknown>;
  /**
   * Ids of this message's tool calls the approval gate paused — sent once the run settles.
   * Requested but never executed is the only reliable "awaiting approval" signal; position in
   * the message list is not, since tool results and later AI text arrive after the call.
   */
  pendingToolCallIds?: string[];
  /**
   * Questions a connected server asked mid-call (MCP elicitation), sent once the run settles. A
   * call paused this way already passed the approval gate, so it is never in `pendingToolCallIds`.
   */
  pendingElicitations?: PendingElicitation[];
}

export interface ToolMessageData {
  id: string;
  content: string;
  status: string;
  /** Tool output for the client only — never sent to the model (e.g. a chart's resolved rows). */
  artifact?: unknown;
  tool_call_id: string;
  name: string;
  metadata?: Record<string, unknown>;
  additional_kwargs?: Record<string, unknown>;
  response_metadata?: Record<string, unknown>;
}

export interface BasicMessageData {
  id: string;
  content: string;
  attachments?: FileAttachment[];
  /** Error messages only: the failure's code, and the raw error behind a toggle. */
  code?: string;
  detail?: string;
}

export interface RecordedDecision {
  decision: ApprovalDecision;
  /** Sent to the server; no longer changeable. */
  sent: boolean;
  /** Approved, but sent alongside a denial, so it did not run (see approvalDecisions.ts). */
  heldBack?: boolean;
}

export interface ToolApprovalCallbacks {
  onApprove: (toolCallId: string) => void;
  onDeny: (toolCallId: string) => void;
  /** Withdraw a decision recorded while the rest of its batch is still undecided. */
  onUndo: (toolCallId: string) => void;
  /** Per call id. Recorded locally first; the batch resumes only once every call has one. */
  decisions: Record<string, RecordedDecision>;
  /** Pending calls in the batch with no decision yet. */
  undecided: number;
  /** Gated calls in the current batch, decided or not. */
  batchSize: number;
}

/** The chat's side of a server's question (MCP elicitation); see ElicitationCard. */
export interface ElicitationCallbacks {
  onAnswer: (interruptId: string, responses: ElicitationResponses) => void;
  /** Per interrupt id: whether an answer is recorded, and whether it was sent. */
  answered: Record<string, { sent: boolean }>;
  /** Questions in this round still without an answer. */
  unanswered: number;
  /** A response is streaming; answering waits for it. */
  busy: boolean;
}

export interface MessageResponse {
  type: "human" | "ai" | "tool" | "error";

  data: BasicMessageData | AIMessageData | ToolMessageData;
}

export interface MultimodalMessageContent {
  type: string;
  text?: string;
  image_url?: { url: string };
}

// Content item types for checkpoint-loaded messages
export interface ImageUrlContentItem {
  type: "image_url";
  image_url?: { url: string };
  file_metadata?: FileAttachment;
  id?: string;
  name?: string;
}

export interface TextContentItem {
  type: "text";
  text: string;
  file_metadata?: FileAttachment;
}
