"use client";
import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkX } from "lucide-react";
import { MEMORIES_QUERY_KEY, deleteMemory } from "@/lib/memory/client";

/**
 * What `remember` or `forget` changed. These tools aren't gated, so this card is how the owner
 * learns Cameron's memory changed — it stays visible, and a saved memory can be forgotten here.
 */

interface MemoryView {
  id: string;
  title: string;
  content?: string;
}

interface Payload {
  ok?: boolean;
  replaced?: boolean;
  memory?: MemoryView;
  forgotten?: MemoryView[];
  missing?: string[];
}

type ForgetState = "idle" | "busy" | "done" | "gone" | "failed";

const Label = ({ children }: { children: string }) => (
  <span className="text-muted-foreground font-mono text-[10px] tracking-[0.13em]">{children}</span>
);

const ManageLink = () => (
  <Link
    href="/memory"
    className="text-muted-foreground hover:text-foreground ml-auto font-mono text-[11px] underline-offset-2 hover:underline"
  >
    Manage memories
  </Link>
);

const Saved = ({ memory, replaced }: { memory: MemoryView; replaced: boolean }) => {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ForgetState>("idle");

  async function forget() {
    setState("busy");
    const result = await deleteMemory(memory.id);
    setState(result === "deleted" ? "done" : result === "not_found" ? "gone" : "failed");
    if (result !== "failed") void queryClient.invalidateQueries({ queryKey: MEMORIES_QUERY_KEY });
  }

  const forgotten = state === "done" || state === "gone";

  return (
    <div className="border-border bg-card overflow-hidden rounded-lg border">
      <div className="border-border bg-muted/40 flex items-center gap-2 border-b px-3.5 py-2">
        <Bookmark className="text-muted-foreground h-3.5 w-3.5" />
        <Label>{forgotten ? "FORGOTTEN" : replaced ? "MEMORY UPDATED" : "REMEMBERED"}</Label>
        <ManageLink />
      </div>
      <div className={`space-y-1 px-4 py-3 ${forgotten ? "opacity-60" : ""}`}>
        <div className={`text-foreground text-sm font-medium ${forgotten ? "line-through" : ""}`}>
          {memory.title}
        </div>
        {memory.content && (
          <div className="text-foreground/80 text-[13px] leading-relaxed">{memory.content}</div>
        )}
      </div>
      <div className="border-border flex items-center gap-3 border-t px-4 py-2">
        {forgotten ? (
          <span className="text-muted-foreground text-xs">
            {state === "done"
              ? "Forgotten. Cameron won't use it from your next message."
              : "Already forgotten."}
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={forget}
              disabled={state === "busy"}
              className="border-border text-foreground hover:bg-muted inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs disabled:cursor-default disabled:opacity-60"
            >
              <BookmarkX className="h-3.5 w-3.5" />
              {state === "busy" ? "Forgetting…" : "Forget"}
            </button>
            {state === "failed" && (
              <span className="text-destructive text-xs">Couldn&apos;t forget it. Try again.</span>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const Forgotten = ({ memories }: { memories: MemoryView[] }) => (
  <div className="border-border bg-card overflow-hidden rounded-lg border">
    <div className="border-border bg-muted/40 flex items-center gap-2 border-b px-3.5 py-2">
      <BookmarkX className="text-muted-foreground h-3.5 w-3.5" />
      <Label>FORGOTTEN</Label>
      <ManageLink />
    </div>
    <ul className="space-y-1 px-4 py-3">
      {memories.map((m) => (
        <li key={m.id} className="text-foreground/80 text-sm line-through">
          {m.title}
        </li>
      ))}
    </ul>
  </div>
);

/** A successful `remember` or `forget` payload; anything else renders as JSON. */
export function isMemoryChange(p: Record<string, unknown>): boolean {
  if (p.ok !== true) return false;
  const memory = p.memory as MemoryView | undefined;
  if (memory && typeof memory.id === "string" && typeof memory.title === "string") return true;
  return Array.isArray(p.forgotten) && p.forgotten.length > 0;
}

export const MemoryNotice = ({ payload }: { payload: Payload }) =>
  payload.memory ? (
    <Saved memory={payload.memory} replaced={payload.replaced === true} />
  ) : (
    <Forgotten memories={payload.forgotten ?? []} />
  );
