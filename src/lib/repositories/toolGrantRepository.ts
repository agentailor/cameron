import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import db from "@/lib/database/db";
import { toolGrants } from "@/lib/database/schema";
import type { GrantScope, ToolGrant } from "@/types/grant";

/**
 * Persistence for tool grants: tools the owner lets run without approval, per scope. The ONLY
 * ORM seam for `tool_grant`. Which tools may be granted is the caller's rule (lib/tasks/grants.ts),
 * not this file's. An MCP grant carries its server's id, and the foreign key deletes it with the
 * server. See docs/GRANTS.md.
 */

const inScope = (scope: GrantScope) =>
  and(eq(toolGrants.scopeKind, scope.kind), eq(toolGrants.scopeId, scope.id));

/** The scope's grants, sorted by tool. */
export async function listGrants(scope: GrantScope): Promise<ToolGrant[]> {
  return db
    .select({ tool: toolGrants.tool, serverId: toolGrants.serverId })
    .from(toolGrants)
    .where(inScope(scope))
    .orderBy(asc(toolGrants.tool));
}

/** The granted tool names, sorted. */
export async function listTools(scope: GrantScope): Promise<string[]> {
  return (await listGrants(scope)).map((g) => g.tool);
}

/** Replace a scope's grants with exactly these, in one transaction. */
export async function replaceGrants(scope: GrantScope, grants: ToolGrant[]): Promise<void> {
  const unique = [...new Map(grants.map((g) => [g.tool, g])).values()];
  await db.transaction(async (tx) => {
    await tx.delete(toolGrants).where(inScope(scope));
    if (unique.length > 0) {
      await tx.insert(toolGrants).values(
        unique.map((g) => ({
          id: randomUUID(),
          scopeKind: scope.kind,
          scopeId: scope.id,
          tool: g.tool,
          serverId: g.serverId,
        })),
      );
    }
  });
}
