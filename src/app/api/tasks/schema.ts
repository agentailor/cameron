import { z } from "@/lib/api/openapi/zod";
import { registry } from "@/lib/api/openapi/registry";
import { ErrorResponse } from "@/lib/api/openapi/common";

export const TaskResponse = z
  .object({
    name: z.string(),
    description: z.string(),
    schedule: z.string().openapi({ example: "0 8 * * MON" }),
    timezone: z.string(),
    enabled: z.boolean(),
    nextRunAt: z.iso.datetime().nullable(),
  })
  .openapi("Task");

export const TaskRunResponse = z
  .object({
    id: z.string(),
    taskName: z.string(),
    slot: z.iso.datetime(),
    trigger: z.enum(["schedule", "manual"]),
    status: z.enum(["running", "paused", "done", "failed"]),
    pauseReason: z.string().nullable(),
    error: z.string().nullable(),
    threadId: z.string().nullable(),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
  })
  .openapi("TaskRun");

const jsonBody = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });

registry.registerPath({
  method: "get",
  path: "/api/tasks",
  operationId: "listTasks",
  summary: "List scheduled tasks and recent runs",
  description: "Every task file with whether it is enabled, plus the 50 most recent runs.",
  tags: ["Tasks"],
  responses: {
    200: {
      description: "Tasks and runs",
      ...jsonBody(z.object({ tasks: z.array(TaskResponse), runs: z.array(TaskRunResponse) })),
    },
    500: { description: "Failed to list tasks", ...jsonBody(ErrorResponse) },
  },
});
