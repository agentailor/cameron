import { z } from "@/lib/api/openapi/zod";
import { registry } from "@/lib/api/openapi/registry";

// Projected to the fields the UI renders (see `projectHistory`); `data` varies by message type.
const HistoryMessageData = z
  .object({
    id: z.string().optional(),
    content: z.unknown().optional(),
    tool_calls: z.array(z.unknown()).optional().openapi({ description: "AI messages only" }),
    pendingToolCallIds: z
      .array(z.string())
      .optional()
      .openapi({ description: "Tool calls the approval gate paused" }),
    tool_call_id: z.string().optional().openapi({ description: "Tool messages only" }),
    name: z.string().optional().openapi({ description: "Tool messages only" }),
    status: z.string().optional().openapi({ description: "Tool messages only" }),
    artifact: z.unknown().optional().openapi({ description: "Client-only tool output (charts)" }),
    attachments: z.array(z.unknown()).optional().openapi({ description: "Human messages only" }),
  })
  .openapi("HistoryMessageData");

const HistoryMessage = z
  .object({
    type: z.enum(["human", "ai", "tool", "error"]),
    data: HistoryMessageData,
  })
  .openapi("HistoryMessage");

registry.registerPath({
  method: "get",
  path: "/api/agent/history/{threadId}",
  operationId: "getThreadHistory",
  summary: "Get thread message history",
  description: "Returns the message history for a thread from LangGraph checkpoints.",
  tags: ["Threads"],
  request: {
    params: z.object({
      threadId: z.string().openapi({ description: "Thread identifier" }),
    }),
  },
  responses: {
    200: {
      description: "Array of messages",
      content: { "application/json": { schema: z.array(HistoryMessage) } },
    },
  },
});
