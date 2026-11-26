import type { GrantsView } from "@/types/task";
import type { ToolGrant } from "@/types/grant";
import { BUILT_IN_RISK, BUILT_IN_WRITES, grantInfo } from "./grants";
import type { ServerTools } from "./toolInfo";

/**
 * The grant editor's payload: every tool a task could be granted, what is granted, and what its
 * file suggests. Pure, so it tests without the catalog.
 */
export function toGrantsView(input: {
  task: string;
  granted: readonly string[];
  suggested: readonly string[];
  servers: ServerTools[];
}): GrantsView {
  const granted = new Set(input.granted);
  const suggested = new Set(input.suggested);
  const known = new Set<string>(BUILT_IN_WRITES);

  const builtIn = BUILT_IN_WRITES.map((tool) => {
    const info = grantInfo(tool);
    return {
      tool,
      risk: info.status === "grantable" ? (BUILT_IN_RISK[tool] ?? null) : null,
      grantable: info.status === "grantable",
      granted: info.status === "grantable" && granted.has(tool),
      suggested: suggested.has(tool),
    };
  });

  const servers = input.servers.map(({ server, tools }) => ({
    server,
    tools: tools.map((t) => {
      known.add(t.tool);
      return {
        tool: t.tool,
        name: t.name,
        readOnly: t.readOnly,
        granted: granted.has(t.tool),
        suggested: suggested.has(t.tool),
      };
    }),
  }));

  // Granted or suggested, but nowhere to be found now: a server turned off, removed or renamed,
  // or a name that never existed. Built-in reads need no grant, so they aren't listed.
  const missing = [...new Set([...input.granted, ...input.suggested])]
    .filter((t) => !known.has(t) && grantInfo(t).status !== "already_runs")
    .sort()
    .map((tool) => ({ tool, granted: granted.has(tool), suggested: suggested.has(tool) }));

  return { task: input.task, builtIn, servers, missing };
}

/**
 * Whether the owner may save this grant: grantable, and either listed now or already granted
 * (so a server turned off for a while doesn't force dropping its grants).
 */
export function grantRefusal(
  tool: string,
  view: Pick<GrantsView, "builtIn" | "servers">,
  alreadyGranted: ReadonlySet<string>,
): string | null {
  const info = grantInfo(tool);
  if (info.status === "never") return `${tool} is a hard delete, so it always needs your approval.`;
  if (info.status === "already_runs") return `${tool} already runs without approval.`;
  const listed =
    view.builtIn.some((t) => t.tool === tool) ||
    view.servers.some((s) => s.tools.some((t) => t.tool === tool));
  if (!listed && !alreadyGranted.has(tool)) {
    return `${tool} isn't a tool of Cameron's or of a connected server.`;
  }
  return null;
}

/**
 * Each tool to save, with its server: a server tool takes the id of the server listing it now, a
 * tool kept while its server is off keeps the id it had, and Cameron's own tools have none.
 */
export function withServers(
  tools: readonly string[],
  servers: Pick<ServerTools, "serverId" | "tools">[],
  existing: readonly ToolGrant[],
): ToolGrant[] {
  const listed = new Map<string, string>();
  for (const s of servers) for (const t of s.tools) listed.set(t.tool, s.serverId);
  const before = new Map(existing.map((g) => [g.tool, g.serverId]));
  return tools.map((tool) => ({ tool, serverId: listed.get(tool) ?? before.get(tool) ?? null }));
}
