import { z } from "@/lib/api/openapi/zod";
import { registry } from "@/lib/api/openapi/registry";
import { ErrorResponse } from "@/lib/api/openapi/common";

registry.registerPath({
  method: "get",
  path: "/api/files/{key}",
  operationId: "getFile",
  summary: "Download an uploaded file",
  description:
    "Streams a file uploaded through `/api/agent/upload` from the private bucket. Only upload " +
    "keys (`<uuid>.<ext>`) are served; anything else is a 404.",
  tags: ["Files"],
  request: {
    params: z.object({
      key: z.string().openapi({ description: "Object key returned by the upload endpoint" }),
    }),
  },
  responses: {
    200: {
      description: "The file's bytes, with its stored Content-Type and Content-Disposition",
      content: {
        "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) },
      },
    },
    404: {
      description: "Not an upload key, or no such file",
      content: { "application/json": { schema: ErrorResponse } },
    },
    500: {
      description: "Storage could not be read",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});
