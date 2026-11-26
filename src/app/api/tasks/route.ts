import { NextResponse } from "next/server";
import * as taskRepo from "@/lib/repositories/taskRepository";
import { defaultTimezone, listTasks } from "@/lib/tasks/registry";
import { readGlobalLimits, writeGlobalLimits } from "@/lib/tasks/settings";
import { toLimitsView, toRunView, toTaskView } from "@/lib/tasks/view";
import * as grantRepo from "@/lib/repositories/toolGrantRepository";
import type { TasksResponse } from "@/types/task";
import { SetTaskLimitsRequest, firstIssue } from "./schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const [settings, runs, global] = await Promise.all([
      taskRepo.listSettings(),
      taskRepo.listRuns({ limit: 50 }),
      readGlobalLimits(),
    ]);
    const byName = new Map(settings.map((s) => [s.taskName, s]));
    const now = new Date();
    const tasks = listTasks();
    const grants = await Promise.all(
      tasks.map((t) => grantRepo.listTools({ kind: "task", id: t.name })),
    );
    const body: TasksResponse = {
      tasks: tasks.map((t, i) =>
        toTaskView(t, byName.get(t.name), defaultTimezone(), now, grants[i]),
      ),
      runs: runs.map(toRunView),
      limits: toLimitsView(global),
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error("Error listing tasks:", error);
    return NextResponse.json({ error: "Failed to list tasks" }, { status: 500 });
  }
}

/** Set (number) or clear (null) the limits for all tasks. Absent fields are left as they are. */
export async function PUT(request: Request) {
  const parsed = SetTaskLimitsRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  try {
    return NextResponse.json(toLimitsView(await writeGlobalLimits(parsed.data)));
  } catch (error) {
    console.error("Error saving task limits:", error);
    return NextResponse.json({ error: "Failed to save task limits" }, { status: 500 });
  }
}
