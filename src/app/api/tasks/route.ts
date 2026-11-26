import { NextResponse } from "next/server";
import * as taskRepo from "@/lib/repositories/taskRepository";
import { defaultTimezone, listTasks } from "@/lib/tasks/registry";
import { parseLimit, type LimitField } from "@/lib/tasks/limits";
import { readGlobalLimits, writeGlobalLimits } from "@/lib/tasks/settings";
import { toLimitsView, toRunView, toTaskView } from "@/lib/tasks/view";
import type { TasksResponse } from "@/types/task";

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
    const body: TasksResponse = {
      tasks: listTasks().map((t) => toTaskView(t, byName.get(t.name), defaultTimezone(), now)),
      runs: runs.map(toRunView),
      limits: toLimitsView(global),
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error("Error listing tasks:", error);
    return NextResponse.json({ error: "Failed to list tasks" }, { status: 500 });
  }
}

const GLOBAL_FIELDS: LimitField[] = ["maxConcurrentRuns", "timeoutMinutes", "maxRetries"];

/** Set (number) or clear (null) the global limits. Absent fields are left as they are. */
export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }
  const input: Partial<Record<LimitField, number | null>> = {};
  for (const field of GLOBAL_FIELDS) {
    if (!(field in body)) continue;
    const parsed = parseLimit(field, body[field]);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    input[field] = parsed.value;
  }
  try {
    return NextResponse.json(toLimitsView(await writeGlobalLimits(input)));
  } catch (error) {
    console.error("Error saving task limits:", error);
    return NextResponse.json({ error: "Failed to save task limits" }, { status: 500 });
  }
}
