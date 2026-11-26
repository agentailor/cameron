import { z } from "@/lib/api/openapi/zod";
import { registry } from "@/lib/api/openapi/registry";
import { ErrorResponse } from "@/lib/api/openapi/common";

export const SetGrantsRequest = z
  .object({
    tools: z.array(z.string(), { error: "tools must be a list of tool names." }),
  })
  .openapi("SetGrantsRequest");

const Flags = { granted: z.boolean(), suggested: z.boolean() };

export const GrantsResponse = z
  .object({
    task: z.string(),
    builtIn: z.array(
      z.object({
        tool: z.string(),
        risk: z.enum(["adds", "changes", "bulk"]).nullable(),
        grantable: z.boolean(),
        ...Flags,
      }),
    ),
    servers: z.array(
      z.object({
        server: z.string(),
        tools: z.array(
          z.object({
            tool: z.string(),
            name: z.string(),
            readOnly: z.boolean().nullable(),
            ...Flags,
          }),
        ),
      }),
    ),
    missing: z.array(z.object({ tool: z.string(), ...Flags })),
  })
  .openapi("TaskGrants");

const jsonBody = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });
const request = { params: z.object({ name: z.string() }) };

registry.registerPath({
  method: "get",
  path: "/api/tasks/{name}/grants",
  operationId: "listTaskGrants",
  summary: "List the tools a task could be granted",
  description:
    "Cameron's own writes (with their risk), each enabled server's tools from its stored " +
    "catalog, what is granted, and what the task's file suggests. Never connects to a server.",
  tags: ["Tasks"],
  request,
  responses: {
    200: { description: "The grants", ...jsonBody(GrantsResponse) },
    404: { description: "Task not found", ...jsonBody(ErrorResponse) },
    500: { description: "Failed to list grants", ...jsonBody(ErrorResponse) },
  },
});

registry.registerPath({
  method: "put",
  path: "/api/tasks/{name}/grants",
  operationId: "setTaskGrants",
  summary: "Set the tools a task runs without approval",
  description:
    "Replaces the task's grants. delete_transaction (a hard delete) and tools that already run " +
    "are refused, and so is a tool no server lists, unless it was already granted. Applies " +
    "from the task's next run.",
  tags: ["Tasks"],
  request: {
    ...request,
    body: { content: { "application/json": { schema: SetGrantsRequest } } },
  },
  responses: {
    200: { description: "The grants", ...jsonBody(GrantsResponse) },
    400: { description: "A tool that can't be granted", ...jsonBody(ErrorResponse) },
    404: { description: "Task not found", ...jsonBody(ErrorResponse) },
    500: { description: "Failed to save grants", ...jsonBody(ErrorResponse) },
  },
});
