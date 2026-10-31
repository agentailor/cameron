import { z } from "@/lib/api/openapi/zod";
import { registry } from "@/lib/api/openapi/registry";

export const MCPServerCatalogResponse = z
  .object({
    serverId: z.string(),
    toolCount: z.number().int(),
    schemaTokens: z.number().int().openapi({ description: "Rough estimate: JSON length / 4" }),
    summary: z.string(),
    summarySource: z.enum(["instructions", "heuristic", "generated"]),
    refreshedAt: z.iso.datetime(),
  })
  .openapi("MCPServerCatalog");

export const MCPServerCatalogError = z
  .object({
    error: z.enum(["not_found", "auth_required", "invalid_config", "timeout", "connect_failed"]),
    message: z.string(),
  })
  .openapi("MCPServerCatalogError");

const errorBody = { content: { "application/json": { schema: MCPServerCatalogError } } };

registry.registerPath({
  method: "post",
  path: "/api/mcp-servers/{id}/catalog",
  operationId: "refreshMcpServerCatalog",
  summary: "Refresh one MCP server's catalog entry",
  description:
    "Connects to the server, re-reads its tool list and instructions, and rewrites the cached " +
    "catalog row the agent describes it from. A failure leaves the previous row in place.",
  tags: ["MCP Servers"],
  request: { params: z.object({ id: z.string().openapi({ description: "MCP server id" }) }) },
  responses: {
    200: {
      description: "The refreshed catalog entry",
      content: { "application/json": { schema: MCPServerCatalogResponse } },
    },
    404: { description: "Server not found", ...errorBody },
    409: { description: "OAuth connection required first", ...errorBody },
    422: { description: "Server is missing its command or URL", ...errorBody },
    502: { description: "Could not connect to the server", ...errorBody },
    504: { description: "Server did not respond in time", ...errorBody },
  },
});
