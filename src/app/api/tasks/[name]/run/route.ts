import { NextResponse } from "next/server";
import { getScheduler } from "@/lib/tasks/scheduler";
import { toRunView } from "@/lib/tasks/view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Start a task now, enabled or not. Returns at once; the run continues in the background. */
export async function POST(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  try {
    const result = await getScheduler().runNow(name);
    if (!result.ok && result.error === "busy") {
      return NextResponse.json(
        { error: "busy", message: "The limit of runs at once is reached. Try again shortly." },
        { status: 409 },
      );
    }
    if (!result.ok) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    return NextResponse.json(toRunView(result.run), { status: 202 });
  } catch (error) {
    console.error("Error starting task:", error);
    return NextResponse.json({ error: "Failed to start task" }, { status: 500 });
  }
}
