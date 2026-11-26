import { NextResponse } from "next/server";
import * as taskRepo from "@/lib/repositories/taskRepository";
import { defaultTimezone, getTask } from "@/lib/tasks/registry";
import { parseLimit } from "@/lib/tasks/limits";
import { toTaskView } from "@/lib/tasks/view";

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

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }
  if ("enabled" in body && typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  const limits: { timeoutMinutes?: number | null; maxRetries?: number | null } = {};
  for (const field of ["timeoutMinutes", "maxRetries"] as const) {
    if (!(field in body)) continue;
    const parsed = parseLimit(field, body[field]);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    limits[field] = parsed.value;
  }
  if (!("enabled" in body) && Object.keys(limits).length === 0) {
    return NextResponse.json(
      { error: "Nothing to change: send enabled, timeoutMinutes or maxRetries" },
      { status: 400 },
    );
  }

  try {
    if (Object.keys(limits).length > 0) await taskRepo.setLimits(name, limits);
    if (typeof body.enabled === "boolean") await taskRepo.setEnabled(name, body.enabled);
    const setting = await taskRepo.getSetting(name);
    return NextResponse.json(toTaskView(task, setting ?? undefined, defaultTimezone(), new Date()));
  } catch (error) {
    console.error("Error updating task:", error);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}
