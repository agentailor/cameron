import { z } from "@/lib/api/openapi/zod";
import { registry } from "@/lib/api/openapi/registry";
import { ErrorResponse, SuccessResponse } from "@/lib/api/openapi/common";

// Mirrors `Thread` in src/types/message.ts (dates serialized as ISO strings).
export const ThreadResponse = z
  .object({
    id: z.string().openapi({ example: "clx123abc" }),
    title: z.string().openapi({ example: "New thread" }),
    createdAt: z.iso.datetime().openapi({ example: "2026-06-19T12:00:00.000Z" }),
    updatedAt: z.iso.datetime().openapi({ example: "2026-06-19T12:00:00.000Z" }),
  })
  .openapi("Thread");

export const ThreadCursorResponse = z
  .object({
    updatedAt: z.iso.datetime(),
    id: z.string(),
  })
  .openapi("ThreadCursor");

export const ThreadPageResponse = z
  .object({
    threads: z.array(ThreadResponse),
    total: z.number().int().openapi({
      description: "Total threads ignoring the limit, so a capped page is visibly partial.",
      example: 42,
    }),
    nextCursor: ThreadCursorResponse.nullable().openapi({
      description:
        "Pass back as cursorUpdatedAt/cursorId for the next page; null on the last page.",
    }),
  })
  .openapi("ThreadPage");

export const ListThreadsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursorUpdatedAt: z.iso.datetime().optional(),
  cursorId: z.string().optional(),
});

export const CreateThreadBody = z
  .object({
    title: z.string().min(1).max(200).optional(),
  })
  .openapi("CreateThreadBody");

export const UpdateThreadBody = z
  .object({
    id: z.string(),
    title: z.string(),
  })
  .openapi("UpdateThreadBody");

export const DeleteThreadBody = z
  .object({
    id: z.string(),
  })
  .openapi("DeleteThreadBody");

const tags = ["Threads"];
const jsonBody = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });

registry.registerPath({
  method: "get",
  path: "/api/agent/threads",
  operationId: "listThreads",
  summary: "List threads",
  description:
    "One page of threads, most recently updated first. Paged by cursor rather than offset " +
    "because the sort key moves while paging. `total` reports the true count so a capped page " +
    "is visibly partial.",
  tags,
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).optional().openapi({ example: 10 }),
      cursorUpdatedAt: z.iso.datetime().optional(),
      cursorId: z.string().optional(),
    }),
  },
  responses: {
    200: { description: "A page of threads", ...jsonBody(ThreadPageResponse) },
    400: { description: "Invalid pagination parameters", ...jsonBody(ErrorResponse) },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/agent/threads",
  operationId: "createThread",
  summary: "Create a thread",
  description:
    'Creates a thread. `title` is optional and defaults to "New thread"; the client derives it ' +
    "from the first message.",
  tags,
  request: { body: { required: false, ...jsonBody(CreateThreadBody) } },
  responses: {
    201: { description: "Created thread", ...jsonBody(ThreadResponse) },
    400: { description: "Invalid title", ...jsonBody(ErrorResponse) },
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/agent/threads",
  operationId: "renameThread",
  summary: "Rename a thread",
  tags,
  request: { body: { ...jsonBody(UpdateThreadBody) } },
  responses: {
    200: { description: "Updated thread", ...jsonBody(ThreadResponse) },
    400: { description: "id and title required", ...jsonBody(ErrorResponse) },
    500: { description: "Update failed", ...jsonBody(ErrorResponse) },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/agent/threads",
  operationId: "deleteThread",
  summary: "Delete a thread",
  description:
    "Deletes thread metadata. LangGraph checkpoint data becomes orphaned but does not affect functionality.",
  tags,
  request: { body: { ...jsonBody(DeleteThreadBody) } },
  responses: {
    200: { description: "Deleted", ...jsonBody(SuccessResponse) },
    400: { description: "Thread id required", ...jsonBody(ErrorResponse) },
    404: { description: "Thread not found", ...jsonBody(ErrorResponse) },
    500: { description: "Delete failed", ...jsonBody(ErrorResponse) },
  },
});
