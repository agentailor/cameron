import { NextResponse } from "next/server";
import * as taskRepo from "@/lib/repositories/taskRepository";
import { defaultTimezone, getTask } from "@/lib/tasks/registry";
import { toTaskView } from "@/lib/tasks/view";
import { SetTaskEnabledRequest } from "./schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Turn a task on or off. On starts its clock now: earlier slots never run. */
export async function PUT(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const task = getTask(name);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const parsed = SetTaskEnabledRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Body must be { enabled: boolean }" }, { status: 400 });
  }

  try {
    const setting = await taskRepo.setEnabled(name, parsed.data.enabled);
    return NextResponse.json(toTaskView(task, setting, defaultTimezone(), new Date()));
  } catch (error) {
    console.error("Error updating task:", error);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}
