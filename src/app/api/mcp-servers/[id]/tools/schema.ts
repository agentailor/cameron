import { z } from "@/lib/api/openapi/zod";
import { registry } from "@/lib/api/openapi/registry";

const MCPTool = z
  .object({
    name: z.string().openapi({ example: "search" }),
    description: z.string().optional(),
  })
  .openapi("MCPTool");

export const MCPServerToolsResponse = z
  .object({ tools: z.array(MCPTool) })
  .openapi("MCPServerToolsResponse");

export const MCPServerToolsError = z
  .object({
    error: z.enum(["not_found", "auth_required", "invalid_config", "timeout", "connect_failed"]),
    message: z.string(),
  })
  .openapi("MCPServerToolsError");

const errorBody = { content: { "application/json": { schema: MCPServerToolsError } } };

registry.registerPath({
  method: "get",
  path: "/api/mcp-servers/{id}/tools",
  operationId: "listMcpServerTools",
  summary: "List one MCP server's tools",
  description:
    "Connects to the server (enabled or not), lists its tools, and closes the connection. " +
    "A connection failure is reported, never returned as an empty list.",
  tags: ["MCP Servers"],
  request: { params: z.object({ id: z.string().openapi({ description: "MCP server id" }) }) },
  responses: {
    200: {
      description: "The server's tools",
      content: { "application/json": { schema: MCPServerToolsResponse } },
    },
    404: { description: "Server not found", ...errorBody },
    409: { description: "OAuth connection required first", ...errorBody },
    422: { description: "Server is missing its command or URL", ...errorBody },
    502: { description: "Could not connect to the server", ...errorBody },
    504: { description: "Server did not respond in time", ...errorBody },
  },
});
