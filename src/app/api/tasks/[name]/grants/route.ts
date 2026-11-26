import { NextResponse } from "next/server";
import * as grantRepo from "@/lib/repositories/toolGrantRepository";
import { getTask } from "@/lib/tasks/registry";
import { grantRefusal, toGrantsView, withServers } from "@/lib/tasks/grantsView";
import { listServerTools } from "@/lib/tasks/toolInfo";
import { firstIssue } from "../../schema";
import { SetGrantsRequest } from "./schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ name: string }> };

async function viewFor(name: string, suggested: string[] = []) {
  const [grants, servers] = await Promise.all([
    grantRepo.listGrants({ kind: "task", id: name }),
    listServerTools(),
  ]);
  const granted = grants.map((g) => g.tool);
  return { grants, servers, view: toGrantsView({ task: name, granted, suggested, servers }) };
}

/** Every tool the task could be granted, what is granted, and what its file suggests. */
export async function GET(_request: Request, { params }: Params) {
  const { name } = await params;
  const task = getTask(name);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  try {
    return NextResponse.json((await viewFor(name, task.tools)).view);
  } catch (error) {
    console.error("Error listing grants:", error);
    return NextResponse.json({ error: "Failed to list grants" }, { status: 500 });
  }
}

/** Replace the task's grants. Applies from its next run; a run in progress keeps its own. */
export async function PUT(request: Request, { params }: Params) {
  const { name } = await params;
  const task = getTask(name);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const parsed = SetGrantsRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  }

  try {
    const { grants, servers, view } = await viewFor(name);
    const already = new Set(grants.map((g) => g.tool));
    for (const tool of parsed.data.tools) {
      const refusal = grantRefusal(tool, view, already);
      if (refusal) return NextResponse.json({ error: refusal }, { status: 400 });
    }
    await grantRepo.replaceGrants(
      { kind: "task", id: name },
      withServers(parsed.data.tools, servers, grants),
    );
    return NextResponse.json((await viewFor(name, task.tools)).view);
  } catch (error) {
    console.error("Error saving grants:", error);
    return NextResponse.json({ error: "Failed to save grants" }, { status: 500 });
  }
}
