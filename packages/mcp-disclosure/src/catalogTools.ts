import { DynamicStructuredTool, type StructuredToolInterface } from "@langchain/core/tools";
import { TOOL_NAME_SEPARATOR } from "./policy";
import type { DisclosureServer } from "./types";

export class CatalogToolNotRunnable extends Error {}

/**
 * One stand-in tool per catalog entry, named `server__tool`, built WITHOUT connecting. The model
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
      server.catalog.tools.map((t) => {
        const name = `${server.name}${TOOL_NAME_SEPARATOR}${t.name}`;
        return new DynamicStructuredTool({
          name,
          description: t.description ?? "",
          schema: t.inputSchema as Record<string, unknown>,
          func: async () => {
            throw new CatalogToolNotRunnable(
              `${name} is a catalog stand-in; it must be run through the disclosure middleware.`,
            );
          },
        });
      }),
    );
  }
  return byServer;
}
