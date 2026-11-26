import { z } from "@/lib/api/openapi/zod";
import { registry } from "@/lib/api/openapi/registry";
import { ErrorResponse } from "@/lib/api/openapi/common";
import { TaskRunResponse } from "../../schema";

const jsonBody = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });

registry.registerPath({
  method: "post",
  path: "/api/tasks/{name}/run",
  operationId: "runTaskNow",
  summary: "Run a scheduled task now",
  description:
    "Starts a manual run, whether or not the task is enabled, and returns at once. The run " +
    "continues in the background on a new thread.",
  tags: ["Tasks"],
  request: { params: z.object({ name: z.string() }) },
  responses: {
    202: { description: "The run, just started", ...jsonBody(TaskRunResponse) },
    404: { description: "Task not found", ...jsonBody(ErrorResponse) },
    409: { description: "At the limit of runs at once", ...jsonBody(ErrorResponse) },
    500: { description: "Failed to start task", ...jsonBody(ErrorResponse) },
  },
});
