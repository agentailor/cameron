"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkX } from "lucide-react";
import {
  MEMORIES_QUERY_KEY,
  deleteMemory,
  fetchMemories,
  type MemoryRecord,
} from "@/lib/memory/client";

const MemoryItem = ({ memory }: { memory: MemoryRecord }) => {
  const queryClient = useQueryClient();
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");

  async function forget() {
    setState("busy");
    const result = await deleteMemory(memory.id);
    if (result === "failed") return setState("failed");
    await queryClient.invalidateQueries({ queryKey: MEMORIES_QUERY_KEY });
  }

  return (
    <li className="border-border rounded-lg border bg-white p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-foreground text-sm font-medium break-words">{memory.title}</div>
          <p className="text-foreground/80 text-sm leading-relaxed break-words">{memory.content}</p>
          <div className="text-muted-foreground flex flex-wrap gap-x-3 font-mono text-[11px]">
            <span>saved {new Date(memory.createdAt).toLocaleDateString()}</span>
            {memory.updatedAt !== memory.createdAt && (
              <span>updated {new Date(memory.updatedAt).toLocaleDateString()}</span>
            )}
            {memory.sourceThreadId && (
              <Link
                href={`/thread/${memory.sourceThreadId}`}
                className="hover:text-foreground underline-offset-2 hover:underline"
              >
                from this conversation
              </Link>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={forget}
          disabled={state === "busy"}
          className="border-border text-foreground hover:bg-muted inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs disabled:cursor-default disabled:opacity-60"
        >
          <BookmarkX className="h-3.5 w-3.5" />
          {state === "busy" ? "Forgetting…" : "Forget"}
        </button>
      </div>
      {state === "failed" && (
        <p className="text-destructive mt-2 text-xs">Couldn&apos;t forget it. Try again.</p>
      )}
    </li>
  );
};

export const MemoryList = () => {
  const { data, isPending, isError } = useQuery({
    queryKey: MEMORIES_QUERY_KEY,
    queryFn: fetchMemories,
  });

  if (isPending) return <p className="text-muted-foreground mt-8 text-sm">Loading…</p>;
  if (isError) {
    return <p className="text-destructive mt-8 text-sm">Couldn&apos;t load your memories.</p>;
  }
  if (data.length === 0) {
    return (
      <p className="text-muted-foreground mt-8 text-sm leading-relaxed">
        Nothing yet. Tell Cameron &ldquo;remember that…&rdquo; or correct it, and the preference
        shows up here.
      </p>
    );
  }

  return (
    <ul className="mt-8 space-y-3">
      {data.map((m) => (
        <MemoryItem key={m.id} memory={m} />
      ))}
    </ul>
  );
};
