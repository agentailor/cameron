import * as threadRepo from "@/lib/repositories/threadRepository";

/**
 * Ensure a thread exists; create if missing. Title derived from seed (first 100 chars) or fallback.
 * Returns the thread record.
 */
export async function ensureThread(threadId: string, titleSeed?: string) {
  if (!threadId) throw new Error("threadId is required");
  const existing = await threadRepo.getById(threadId);
  if (existing) return existing;
  const title = (titleSeed?.trim() || "New thread").substring(0, 100);
  return threadRepo.create({ id: threadId, title });
}
