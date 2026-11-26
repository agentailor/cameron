import { NextResponse } from "next/server";
import * as taskRepo from "@/lib/repositories/taskRepository";
import { defaultTimezone, getTask } from "@/lib/tasks/registry";
import { toTaskView } from "@/lib/tasks/view";
import * as grantRepo from "@/lib/repositories/toolGrantRepository";
import { firstIssue } from "../schema";
import { UpdateTaskRequest } from "./schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Turn a task on or off, and/or set (number) or clear (null) its own timeout and retries.
 * On starts its clock now: earlier slots never run.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const task = getTask(name);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const parsed = UpdateTaskRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { enabled, ...limits } = parsed.data;
  if (enabled === undefined && Object.keys(limits).length === 0) {
    return NextResponse.json(
      { error: "Nothing to change: send enabled, timeoutMinutes or maxRetries" },
      { status: 400 },
    );
  }

  try {
    if (Object.keys(limits).length > 0) await taskRepo.setLimits(name, limits);
    if (enabled !== undefined) await taskRepo.setEnabled(name, enabled);
    const setting = await taskRepo.getSetting(name);
    const grants = await grantRepo.listTools({ kind: "task", id: name });
    return NextResponse.json(
      toTaskView(task, setting ?? undefined, defaultTimezone(), new Date(), grants),
    );
  } catch (error) {
    console.error("Error updating task:", error);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}
