import { after, NextResponse } from "next/server";
import * as mcpServerRepo from "@/lib/repositories/mcpServerRepository";
import { ConflictError } from "@/lib/repositories/mcpServerRepository";
import { refreshCatalogQuietly } from "@/lib/mcp/catalog";
import { mcpPool } from "@/lib/mcp/pool";
import { MCPServerType } from "@/types/mcp";
import { UpdateMCPServerBody } from "./schema";

export async function GET() {
  try {
    const servers = await mcpServerRepo.list();
    return NextResponse.json(servers);
  } catch (error) {
    console.error("Error fetching MCP servers:", error);
    return NextResponse.json({ error: "Failed to fetch MCP servers" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, description, type, command, args, env, url, headers } = body;

    if (!name || !type) {
      return NextResponse.json({ error: "Name and type are required" }, { status: 400 });
    }

    if (type === "stdio" && !command) {
      return NextResponse.json({ error: "Command is required for stdio servers" }, { status: 400 });
    }

    if (type === "http" && !url) {
      return NextResponse.json({ error: "URL is required for http servers" }, { status: 400 });
    }

    const server = await mcpServerRepo.create({
      name,
      description: description?.trim() || null,
      type: type as MCPServerType,
      command: type === "stdio" ? command : null,
      args: type === "stdio" ? args : null,
      env: type === "stdio" ? env : null,
      url: type === "http" ? url : null,
      headers: type === "http" ? headers : null,
    });

    // Cache its tool list for the agent's server catalog, after the response is sent.
    after(() => refreshCatalogQuietly(server.id));

    return NextResponse.json(server, { status: 201 });
  } catch (error) {
    console.error("Error creating MCP server:", error);
    if (error instanceof ConflictError) {
      return NextResponse.json({ error: "Server name already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create MCP server" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const parsed = UpdateMCPServerBody.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }
    const { id, name, description, type, command, args, env, url, headers, enabled } = parsed.data;

    const patch: mcpServerRepo.UpdateMCPServerPatch = {};
    if (name !== undefined) patch.name = name;
    if (description !== undefined) patch.description = description.trim() || null;
    if (type !== undefined) patch.type = type as MCPServerType;
    if (enabled !== undefined) patch.enabled = enabled;

    if (type === "stdio") {
      if (command !== undefined) patch.command = command;
      if (args !== undefined) patch.args = args;
      if (env !== undefined) patch.env = env;
      patch.url = null;
      patch.headers = null;
    } else if (type === "http") {
      if (url !== undefined) patch.url = url;
      if (headers !== undefined) patch.headers = headers;
      patch.command = null;
      patch.args = null;
      patch.env = null;
    }

    const server = await mcpServerRepo.update(id, patch);
    if (!server) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }

    // Enabling or editing can change the tool list; a rename alone cannot.
    const reconfigured = [type, command, args, env, url, headers].some((v) => v !== undefined);
    if (enabled === false || reconfigured) mcpPool.invalidate(id);
    if (server.enabled && (enabled === true || reconfigured)) {
      after(() => refreshCatalogQuietly(server.id));
    }

    return NextResponse.json(server);
  } catch (error) {
    console.error("Error updating MCP server:", error);
    if (error instanceof ConflictError) {
      return NextResponse.json({ error: "Server name already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to update MCP server" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    const deleted = await mcpServerRepo.remove(id);
    mcpPool.invalidate(id);
    if (!deleted) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting MCP server:", error);
    return NextResponse.json({ error: "Failed to delete MCP server" }, { status: 500 });
  }
}
