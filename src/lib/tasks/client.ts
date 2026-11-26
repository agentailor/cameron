/** Browser-side access to `/api/tasks`, for the /tasks page and the sidebar. */
import type { TaskLimitsView, TaskRunView, TasksResponse, TaskView } from "@/types/task";

export const TASKS_QUERY_KEY = ["tasks"] as const;

export async function fetchTasks(): Promise<TasksResponse> {
  const res = await fetch("/api/tasks");
  if (!res.ok) throw new Error("Failed to load tasks");
  return res.json();
}

export type SaveResult<T> = { ok: true; value: T } | { ok: false; error: string };

async function send<T>(url: string, method: string, body?: unknown): Promise<SaveResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      ...(body !== undefined
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, value: json as T };
    return { ok: false, error: json.message ?? json.error ?? "Something went wrong." };
  } catch {
    return { ok: false, error: "Couldn't reach Cameron." };
  }
}

/** Turn a task on or off, or set (number) / clear (null) its own timeout and retries. */
export function updateTask(
  name: string,
  body: { enabled?: boolean; timeoutMinutes?: number | null; maxRetries?: number | null },
) {
  return send<TaskView>(`/api/tasks/${encodeURIComponent(name)}`, "PUT", body);
}

export function runTaskNow(name: string) {
  return send<TaskRunView>(`/api/tasks/${encodeURIComponent(name)}/run`, "POST");
}

export function saveTaskLimits(body: {
  maxConcurrentRuns?: number | null;
  timeoutMinutes?: number | null;
  maxRetries?: number | null;
}) {
  return send<TaskLimitsView>("/api/tasks", "PUT", body);
}
