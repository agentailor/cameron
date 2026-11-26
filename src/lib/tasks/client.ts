/** Browser-side access to `/api/tasks`, for the /tasks page and the sidebar. */
import type {
  GrantsView,
  TaskLimitsView,
  TaskRunView,
  TasksResponse,
  TaskView,
} from "@/types/task";

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
  body: {
    enabled?: boolean;
    timeoutMinutes?: number | string | null;
    maxRetries?: number | string | null;
  },
) {
  return send<TaskView>(`/api/tasks/${encodeURIComponent(name)}`, "PUT", body);
}

export function runTaskNow(name: string) {
  return send<TaskRunView>(`/api/tasks/${encodeURIComponent(name)}/run`, "POST");
}

/** Values as typed: the server validates them and returns a readable message. */
export function saveTaskLimits(body: {
  maxConcurrentRuns?: number | string | null;
  timeoutMinutes?: number | string | null;
  maxRetries?: number | string | null;
}) {
  return send<TaskLimitsView>("/api/tasks", "PUT", body);
}

export const grantsQueryKey = (name: string) => ["tasks", name, "grants"] as const;

export async function fetchGrants(name: string): Promise<GrantsView> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(name)}/grants`);
  if (!res.ok) throw new Error("Failed to load grants");
  return res.json();
}

/** Replace the task's grants with exactly these tools. */
export function saveGrants(name: string, tools: string[]) {
  return send<GrantsView>(`/api/tasks/${encodeURIComponent(name)}/grants`, "PUT", { tools });
}
