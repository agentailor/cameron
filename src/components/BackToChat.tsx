"use client";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";

/** Where the sidebar link records the page you left, so this one can send you back to it. */
export const RETURN_TO_KEY = "cameron:return_to";

/**
 * Returns to the page you came from, falling back to `/` on a cold open.
 *
 * Uses an explicit breadcrumb because neither browser signal distinguishes those two cases:
 * `history.length` counts the whole tab session (a new tab already reads 2), and
 * `document.referrer` is empty on a client-side navigation — how this page is normally reached.
 */
export const BackToChat = () => {
  const router = useRouter();
  const [returnTo, setReturnTo] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(RETURN_TO_KEY);
      // Only ever a same-origin app path, never an absolute URL.
      if (stored?.startsWith("/") && !stored.startsWith("//")) setReturnTo(stored);
    } catch {
      // Blocked storage: fall back to `/`.
    }
  }, []);

  return (
    <button
      type="button"
      onClick={() => router.push(returnTo ?? "/")}
      className="text-muted-foreground hover:text-foreground mb-8 inline-flex cursor-pointer items-center gap-2 text-sm transition-colors"
    >
      <ArrowLeft size={16} />
      Back to chat
    </button>
  );
};
