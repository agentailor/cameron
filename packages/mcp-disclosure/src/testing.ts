import type { DisclosureServer } from "./types";

/** Test fixture: an enabled server with a catalog row of the given size. */
export function makeServer(
  name: string,
  opts: {
    tokens?: number;
    tools?: number;
    toolNames?: string[];
    summary?: string;
    authRequired?: boolean;
  } = {},
): DisclosureServer {
  const names = opts.toolNames ?? Array.from({ length: opts.tools ?? 1 }, (_, i) => `tool${i}`);
  const toolCount = names.length;
  return {
    id: `id-${name}`,
    name,
    authRequired: opts.authRequired ?? false,
    catalog: {
      serverId: `id-${name}`,
      toolsHash: "hash",
      tools: names.map((name) => ({
        name,
        description: `fake ${name}`,
        inputSchema: { type: "object", properties: {} },
      })),
      toolCount,
      schemaTokens: opts.tokens ?? 100,
      summary: opts.summary ?? `${name} tools`,
      summarySource: "heuristic",
      refreshedAt: new Date(0),
    },
  };
}
