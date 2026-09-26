import { NextResponse } from "next/server";
import * as mcpServerRepo from "@/lib/repositories/mcpServerRepository";
import { listServerTools, type ServerToolsError } from "@/lib/agent/mcp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS: Record<ServerToolsError, number> = {
  auth_required: 409,
  invalid_config: 422,
  timeout: 504,
  connect_failed: 502,
};

/** Connects to this one server on demand and lists its tools. Nothing is cached server-side. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const server = await mcpServerRepo.getById(id);
  if (!server) {
    return NextResponse.json({ error: "not_found", message: "Server not found" }, { status: 404 });
  }

  const result = await listServerTools(server);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: STATUS[result.error] },
    );
  }
  return NextResponse.json({ tools: result.tools });
}
