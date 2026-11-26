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
    limits: z.object({
      timeoutMinutes: z.number().int().nullable(),
      maxRetries: z.number().int().nullable(),
    }),
  })
  .openapi("Task");

const LimitValues = z.object({
  maxConcurrentRuns: z.number().int(),
  timeoutMinutes: z.number().int(),
  maxRetries: z.number().int(),
});

export const TaskLimitsResponse = z
  .object({
    set: z.object({
      maxConcurrentRuns: z.number().int().nullable(),
      timeoutMinutes: z.number().int().nullable(),
      maxRetries: z.number().int().nullable(),
    }),
    defaults: LimitValues,
  })
  .openapi("TaskLimits");

export const SetTaskLimitsRequest = z
  .object({
    maxConcurrentRuns: z.number().int().min(1).max(10).nullable().optional(),
    timeoutMinutes: z.number().int().min(1).max(1440).nullable().optional(),
    maxRetries: z.number().int().min(0).max(5).nullable().optional(),
  })
  .openapi("SetTaskLimitsRequest");

export const TaskRunResponse = z
  .object({
    id: z.string(),
    taskName: z.string(),
    slot: z.iso.datetime(),
    trigger: z.enum(["schedule", "manual"]),
    status: z.enum(["running", "paused", "done", "failed"]),
    attempts: z.number().int(),
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
  description:
    "Every task file with whether it is enabled and its own limits, the 50 most recent runs, " +
    "and the global limits.",
  tags: ["Tasks"],
  responses: {
    200: {
      description: "Tasks and runs",
      ...jsonBody(
        z.object({
          tasks: z.array(TaskResponse),
          runs: z.array(TaskRunResponse),
          limits: TaskLimitsResponse,
        }),
      ),
    },
    500: { description: "Failed to list tasks", ...jsonBody(ErrorResponse) },
  },
});

registry.registerPath({
  method: "put",
  path: "/api/tasks",
  operationId: "setTaskLimits",
  summary: "Set the global task limits",
  description:
    "Runs at once, and the default timeout (minutes) and retries for every task. A number " +
    "sets a limit, null clears it back to the default, and an absent field is left as it is.",
  tags: ["Tasks"],
  request: { body: { content: { "application/json": { schema: SetTaskLimitsRequest } } } },
  responses: {
    200: { description: "The limits", ...jsonBody(TaskLimitsResponse) },
    400: { description: "A value out of bounds", ...jsonBody(ErrorResponse) },
    500: { description: "Failed to save task limits", ...jsonBody(ErrorResponse) },
  },
});
