import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { Thread } from "@/types/message";
import {
  fetchThreads,
  createNewThread,
  deleteThread,
  type ThreadCursor,
  type ThreadPage,
} from "@/services/chatService";
import { useActiveThreadId } from "./useActiveThreadId";

/** Threads fetched per page. Small on purpose: the sidebar is a recency list, not an archive. */
export const THREADS_PAGE_SIZE = 10;

export interface UseThreadsReturn {
  threads: Thread[];
  activeThreadId: string | null;
  isLoadingThreads: boolean;
  threadError: Error | null;
  /** Total threads on the server, including ones not yet loaded. */
  totalThreads: number;
  hasMoreThreads: boolean;
  isLoadingMore: boolean;
  loadMoreThreads: () => void;
  createThread: (title?: string) => Promise<Thread>;
  deleteThread: (threadId: string) => Promise<void>;
  switchThread: (threadId: string) => void;
  refetchThreads: () => Promise<unknown>;
}

type ThreadPages = InfiniteData<ThreadPage, ThreadCursor | null>;

export function useThreads(): UseThreadsReturn {
  const queryClient = useQueryClient();
  const router = useRouter();
  const activeThreadId = useActiveThreadId();

  const {
    data,
    isLoading: isLoadingThreads,
    error: threadError,
    refetch: refetchThreadsQuery,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<ThreadPage, Error, ThreadPages, ["threads"], ThreadCursor | null>({
    queryKey: ["threads"],
    queryFn: ({ pageParam }) => fetchThreads({ limit: THREADS_PAGE_SIZE, cursor: pageParam }),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const threads = useMemo(() => data?.pages.flatMap((p) => p.threads) ?? [], [data]);
  const totalThreads = data?.pages[data.pages.length - 1]?.total ?? threads.length;

  const createThread = useCallback(
    async (title?: string) => {
      const created = await createNewThread(title);
      // Prepend to the first page rather than refetching every loaded page.
      queryClient.setQueryData<ThreadPages>(["threads"], (old) => {
        if (!old) return old;
        const [first, ...rest] = old.pages;
        return {
          ...old,
          pages: [
            { ...first, threads: [created, ...first.threads], total: first.total + 1 },
            ...rest,
          ],
        };
      });
      return created;
    },
    [queryClient],
  );

  const deleteThreadCallback = useCallback(
    async (threadId: string) => {
      await deleteThread(threadId);
      // Decrement every page's total too, or the "N more" hint keeps counting a deleted thread.
      queryClient.setQueryData<ThreadPages>(["threads"], (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            threads: p.threads.filter((t) => t.id !== threadId),
            total: Math.max(0, p.total - 1),
          })),
        };
      });
      // The URL now points at a deleted row.
      if (activeThreadId === threadId) {
        router.push("/");
      }
      queryClient.removeQueries({ queryKey: ["messages", threadId] });
    },
    [queryClient, router, activeThreadId],
  );

  const switchThread = useCallback(
    (threadId: string) => {
      router.push(`/thread/${threadId}`);
    },
    [router],
  );

  const loadMoreThreads = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return {
    threads,
    activeThreadId,
    isLoadingThreads,
    threadError: threadError as Error | null,
    totalThreads,
    hasMoreThreads: !!hasNextPage,
    isLoadingMore: isFetchingNextPage,
    loadMoreThreads,
    createThread,
    deleteThread: deleteThreadCallback,
    switchThread,
    refetchThreads: refetchThreadsQuery,
  };
}
