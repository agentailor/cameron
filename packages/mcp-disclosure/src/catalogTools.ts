import { DynamicStructuredTool, type StructuredToolInterface } from "@langchain/core/tools";
import { prefixedToolName } from "./policy";
import type { DisclosureServer, McpToolDefinition } from "./types";

export class CatalogToolNotRunnable extends Error {}

/**
 * One stand-in tool per catalog entry, named `server_tool`, built WITHOUT connecting. The model
 * is shown these, with each tool's `inputSchema` exactly as its server listed it; the disclosure
 * middleware swaps in the real tool when one is called. Running a stand-in directly means a call
 * skipped the middleware, which is a wiring bug — so it throws.
 */
export function catalogTools(servers: DisclosureServer[]): Map<string, StructuredToolInterface[]> {
  const byServer = new Map<string, StructuredToolInterface[]>();
  for (const server of servers) {
    if (!server.catalog) continue;
    byServer.set(
      server.id,
      server.catalog.tools.map((t) => standInTool(prefixedToolName(server.name, t.name), t)),
    );
  }
  return byServer;
}

/** One stand-in. The same definition always yields the same tool the model sees. */
export function standInTool(name: string, definition: McpToolDefinition): StructuredToolInterface {
  return new DynamicStructuredTool({
    name,
    description: definition.description ?? "",
    schema: definition.inputSchema as Record<string, unknown>,
    func: async () => {
      throw new CatalogToolNotRunnable(
        `${name} is a catalog stand-in; it must be run through the disclosure middleware.`,
      );
    },
  });
}
