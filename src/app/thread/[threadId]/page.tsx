"use client";

import { Thread } from "@/components/Thread";
import { MainLayout } from "@/components/MainLayout";
import { useActiveThreadId } from "@/hooks/useActiveThreadId";

export default function ThreadPage() {
  const threadId = useActiveThreadId();

  return (
    <MainLayout>
      <Thread threadId={threadId} />
    </MainLayout>
  );
}
