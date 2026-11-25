import { NextResponse } from "next/server";
import * as taskRepo from "@/lib/repositories/taskRepository";
import { defaultTimezone, listTasks } from "@/lib/tasks/registry";
import { toRunView, toTaskView } from "@/lib/tasks/view";
import type { TasksResponse } from "@/types/task";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const [settings, runs] = await Promise.all([
      taskRepo.listSettings(),
      taskRepo.listRuns({ limit: 50 }),
    ]);
    const byName = new Map(settings.map((s) => [s.taskName, s]));
    const now = new Date();
    const body: TasksResponse = {
      tasks: listTasks().map((t) => toTaskView(t, byName.get(t.name), defaultTimezone(), now)),
      runs: runs.map(toRunView),
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error("Error listing tasks:", error);
    return NextResponse.json({ error: "Failed to list tasks" }, { status: 500 });
  }
}
