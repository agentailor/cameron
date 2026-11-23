import { z } from "@/lib/api/openapi/zod";
import { registry } from "@/lib/api/openapi/registry";
import { ErrorResponse, SuccessResponse } from "@/lib/api/openapi/common";

export const MemoryResponse = z
  .object({
    id: z.string(),
    title: z.string(),
    content: z.string(),
    sourceThreadId: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi("Memory");

const tags = ["Memory"];
const jsonBody = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });

registry.registerPath({
  method: "get",
  path: "/api/memories",
  operationId: "listMemories",
  summary: "List remembered preferences",
  description: "Every memory Cameron keeps across threads, oldest first.",
  tags,
  responses: {
    200: { description: "Array of memories", ...jsonBody(z.array(MemoryResponse)) },
    500: { description: "Failed to list memories", ...jsonBody(ErrorResponse) },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/memories",
  operationId: "deleteMemory",
  summary: "Forget a memory",
  description: "The owner deleting a memory directly, without asking the agent.",
  tags,
  request: { query: z.object({ id: z.string() }) },
  responses: {
    200: { description: "Memory deleted", ...jsonBody(SuccessResponse) },
    400: { description: "ID is required", ...jsonBody(ErrorResponse) },
    404: { description: "Memory not found", ...jsonBody(ErrorResponse) },
    500: { description: "Failed to delete memory", ...jsonBody(ErrorResponse) },
  },
});
