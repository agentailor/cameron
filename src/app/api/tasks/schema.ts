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
    grantedTools: z.array(z.string()),
    suggestedGrants: z.array(z.string()),
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

/** A limit in a request body: a whole number in bounds sets it, null clears it, absent leaves it. */
function limit(label: string, min: number, max: number) {
  const error = `${label} must be a whole number from ${min} to ${max}.`;
  return z
    .number({ error })
    .int({ error })
    .min(min, { error })
    .max(max, { error })
    .nullable()
    .optional();
}

export const TIMEOUT_MINUTES = limit("Timeout", 1, 24 * 60);
export const MAX_RETRIES = limit("Retries", 0, 5);

export const SetTaskLimitsRequest = z
  .object({
    maxConcurrentRuns: limit("Runs at once", 1, 10),
    timeoutMinutes: TIMEOUT_MINUTES,
    maxRetries: MAX_RETRIES,
  })
  .openapi("SetTaskLimitsRequest");

/** The first validation message, for a 400 body. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid body.";
}

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
