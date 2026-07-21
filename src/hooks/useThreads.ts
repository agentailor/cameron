import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { Thread } from "@/types/message";
import { fetchThreads, createNewThread, deleteThread } from "@/services/chatService";
import { useThreadContext } from "@/contexts/ThreadContext";

export interface UseThreadsReturn {
  threads: Thread[];
  activeThreadId: string | null;
  isLoadingThreads: boolean;
  threadError: Error | null;
  createThread: () => Promise<Thread>;
  deleteThread: (threadId: string) => Promise<void>;
  switchThread: (threadId: string) => void;
  refetchThreads: () => Promise<unknown>;
}

export function useThreads(): UseThreadsReturn {
  const queryClient = useQueryClient();
  const { activeThreadId, setActiveThreadId } = useThreadContext();

  const {
    data: threads = [],
    isLoading: isLoadingThreads,
    error: threadError,
    refetch: refetchThreadsQuery,
  } = useQuery<Thread[]>({
    queryKey: ["threads"],
    queryFn: () => fetchThreads(),
  });

  const createThread = useCallback(async () => {
    // Delegate to backend; optimistic append after create
    const created = await createNewThread();
    queryClient.setQueryData(["threads"], (old: Thread[] = []) => [created, ...old]);
    setActiveThreadId(created.id);
    return created;
  }, [queryClient, setActiveThreadId]);

  const deleteThreadCallback = useCallback(
    async (threadId: string) => {
      await deleteThread(threadId);
      // Remove from cache optimistically
      queryClient.setQueryData(["threads"], (old: Thread[] = []) =>
        old.filter((thread) => thread.id !== threadId),
      );
      // If we're deleting the active thread, clear the active thread
      if (activeThreadId === threadId) {
        setActiveThreadId(null);
      }
      // Clear messages cache for the deleted thread
      queryClient.removeQueries({ queryKey: ["messages", threadId] });
    },
    [queryClient, setActiveThreadId, activeThreadId],
  );

  const switchThread = useCallback(
    (threadId: string) => {
      setActiveThreadId(threadId);
    },
    [setActiveThreadId],
  );

  return {
    threads,
    activeThreadId,
    isLoadingThreads,
    threadError: threadError as Error | null,
    createThread,
    deleteThread: deleteThreadCallback,
    switchThread,
    refetchThreads: refetchThreadsQuery,
  };
}
