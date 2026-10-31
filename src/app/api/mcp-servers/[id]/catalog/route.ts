import { NextResponse } from "next/server";
import { refreshServerCatalogById } from "@/lib/mcp/catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS = {
  not_found: 404,
  auth_required: 409,
  invalid_config: 422,
  timeout: 504,
  connect_failed: 502,
} as const;

/** Re-reads this server's tool list into the agent's catalog. A failure keeps the previous row. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await refreshServerCatalogById(id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: STATUS[result.error] },
    );
  }
  const { entry } = result;
  return NextResponse.json({
    serverId: entry.serverId,
    toolCount: entry.toolCount,
    schemaTokens: entry.schemaTokens,
    summary: entry.summary,
    summarySource: entry.summarySource,
    refreshedAt: entry.refreshedAt.toISOString(),
  });
}
