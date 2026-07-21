"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MainLayout } from "@/components/MainLayout";
import { useThreads } from "@/hooks/useThreads";
import { Thread } from "@/components/Thread";

export default function Home() {
  const { threads, createThread } = useThreads();
  const router = useRouter();
  const [rootThreadId, setRootThreadId] = useState<string | null>(null);

  useEffect(() => {
    if (threads.length > 0 && !rootThreadId) {
      setRootThreadId(threads[0].id);
    }
  }, [threads, rootThreadId]);

  useEffect(() => {
    if (!rootThreadId) {
      (async () => {
        const t = await createThread();
        setRootThreadId(t.id);
      })();
    }
  }, [rootThreadId, createThread]);

  return (
    <MainLayout>
      {rootThreadId && (
        <Thread
          threadId={rootThreadId}
          onFirstMessageSent={(id) => router.replace(`/thread/${id}`)}
        />
      )}
    </MainLayout>
  );
}
