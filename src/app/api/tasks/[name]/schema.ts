import { z } from "@/lib/api/openapi/zod";
import { registry } from "@/lib/api/openapi/registry";
import { ErrorResponse } from "@/lib/api/openapi/common";
import { TaskResponse } from "../schema";

export const SetTaskEnabledRequest = z
  .object({ enabled: z.boolean() })
  .openapi("SetTaskEnabledRequest");

const jsonBody = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });

registry.registerPath({
  method: "put",
  path: "/api/tasks/{name}",
  operationId: "setTaskEnabled",
  summary: "Turn a scheduled task on or off",
  description: "Turning a task on starts its clock now: slots before that never run.",
  tags: ["Tasks"],
  request: {
    params: z.object({ name: z.string() }),
    body: { content: { "application/json": { schema: SetTaskEnabledRequest } } },
  },
  responses: {
    200: { description: "The task", ...jsonBody(TaskResponse) },
    400: { description: "Invalid body", ...jsonBody(ErrorResponse) },
    404: { description: "Task not found", ...jsonBody(ErrorResponse) },
    500: { description: "Failed to update task", ...jsonBody(ErrorResponse) },
  },
});
