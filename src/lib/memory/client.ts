/** Browser-side access to `/api/memories`, shared by the memory notice and the /memory page. */

export const MEMORIES_QUERY_KEY = ["memories"] as const;

export interface MemoryRecord {
  id: string;
  title: string;
  content: string;
  sourceThreadId: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchMemories(): Promise<MemoryRecord[]> {
  const res = await fetch("/api/memories");
  if (!res.ok) throw new Error("Failed to load memories");
  return res.json();
}

export async function deleteMemory(id: string): Promise<"deleted" | "not_found" | "failed"> {
  try {
    const res = await fetch(`/api/memories?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) return "deleted";
    return res.status === 404 ? "not_found" : "failed";
  } catch {
    return "failed";
  }
}
