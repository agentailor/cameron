/** Browser-side access to `/api/tasks`, for the /tasks page and the sidebar. */
import type { TaskRunView, TasksResponse, TaskView } from "@/types/task";

export const TASKS_QUERY_KEY = ["tasks"] as const;

export async function fetchTasks(): Promise<TasksResponse> {
  const res = await fetch("/api/tasks");
  if (!res.ok) throw new Error("Failed to load tasks");
  return res.json();
}

export async function setTaskEnabled(name: string, enabled: boolean): Promise<TaskView | null> {
  try {
    const res = await fetch(`/api/tasks/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

export async function runTaskNow(name: string): Promise<TaskRunView | null> {
  try {
    const res = await fetch(`/api/tasks/${encodeURIComponent(name)}/run`, { method: "POST" });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}
