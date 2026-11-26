import { z } from "@/lib/api/openapi/zod";
import { registry } from "@/lib/api/openapi/registry";
import { ErrorResponse } from "@/lib/api/openapi/common";
import { TaskResponse } from "../schema";

export const UpdateTaskRequest = z
  .object({
    enabled: z.boolean().optional(),
    timeoutMinutes: z.number().int().min(1).max(1440).nullable().optional(),
    maxRetries: z.number().int().min(0).max(5).nullable().optional(),
  })
  .openapi("UpdateTaskRequest");

const jsonBody = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });

registry.registerPath({
  method: "put",
  path: "/api/tasks/{name}",
  operationId: "updateTask",
  summary: "Update a scheduled task",
  description:
    "Turn it on or off, and/or set (number) or clear (null) its own timeout in minutes and " +
    "retries. Turning it on starts its clock now: slots before that never run.",
  tags: ["Tasks"],
  request: {
    params: z.object({ name: z.string() }),
    body: { content: { "application/json": { schema: UpdateTaskRequest } } },
  },
  responses: {
    200: { description: "The task", ...jsonBody(TaskResponse) },
    400: { description: "Invalid body", ...jsonBody(ErrorResponse) },
    404: { description: "Task not found", ...jsonBody(ErrorResponse) },
    500: { description: "Failed to update task", ...jsonBody(ErrorResponse) },
  },
});
