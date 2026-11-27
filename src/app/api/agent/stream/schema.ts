import { z } from "@/lib/api/openapi/zod";
import { registry } from "@/lib/api/openapi/registry";

/** One decision per pending tool call, keyed by call id. Carried JSON-encoded in `decisions`. */
export const ApprovalDecisions = z
  .record(z.string().min(1), z.enum(["allow", "deny"]))
  .refine((d) => Object.keys(d).length > 0, { message: "decisions must not be empty" });

/** One answer per waiting server request, keyed by interrupt id, then by the server's request key. */
export const ElicitationAnswersParam = z
  .record(
    z.string().min(1),
    z.record(
      z.string().min(1),
      z.object({
        action: z.enum(["accept", "decline", "cancel"]),
        content: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
          .optional(),
      }),
    ),
  )
  .refine((a) => Object.keys(a).length > 0, { message: "answers must not be empty" });

const StreamQuery = z.object({
  content: z.string().openapi({ description: "User message text", example: "Hello" }),
  threadId: z.string().optional().openapi({ description: "Thread identifier" }),
  model: z.string().optional().openapi({ description: "LLM model name" }),
  provider: z
    .string()
    .optional()
    .openapi({ description: "Model provider (openai/google/anthropic)" }),
  decisions: z
    .string()
    .optional()
    .openapi({
      description:
        "Resume a paused approval batch. JSON object mapping EVERY pending tool call id to " +
        '"allow" or "deny". A missing, unknown or extra id is refused and nothing resumes.',
      example: '{"call_abc":"allow","call_def":"deny"}',
    }),
  answers: z
    .string()
    .optional()
    .openapi({
      description:
        "Resume a call a connected server paused with a question (MCP elicitation). JSON object " +
        "mapping EVERY waiting interrupt id to its answers, keyed by the server's request key: " +
        '`{ action: "accept" | "decline" | "cancel", content? }`. Anything unmatched is refused.',
      example:
        '{"int_1":{"approval_choice":{"action":"accept","content":{"approval_choice":"ALLOW_ONCE"}}}}',
    }),
  tools: z
    .string()
    .optional()
    .openapi({ description: "Comma-separated list of enabled tool names" }),
  attachments: z
    .string()
    .optional()
    .openapi({ description: "JSON-encoded array of FileAttachment objects" }),
});

registry.registerPath({
  method: "get",
  path: "/api/agent/stream",
  operationId: "streamAgentResponse",
  summary: "Stream an agent response (SSE)",
  description:
    "Server-Sent Events stream of incremental AI/tool message chunks from the LangGraph agent.\n\n" +
    "Event format:\n" +
    "- `data: <MessageResponse JSON>` — incremental ai/tool chunks\n" +
    "- `event: done` / `data: {}` — completion\n" +
    "- `event: error` / `data: { message, threadId }` — stream error",
  tags: ["Agent"],
  request: { query: StreamQuery },
  responses: {
    200: {
      description: "SSE stream of message chunks",
      content: {
        "text/event-stream": {
          schema: z.string().openapi({ description: "Server-Sent Events stream" }),
        },
      },
    },
  },
});
