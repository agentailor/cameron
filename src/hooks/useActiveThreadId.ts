"use client";
import { usePathname } from "next/navigation";

/**
 * The active thread is whatever the URL says it is. `/` is the new-chat screen, so it is null.
 *
 * Reads the pathname so `history.replaceState` — how the new-chat screen adopts its thread's URL
 * without remounting — is picked up like any navigation.
 */
export function useActiveThreadId(): string | null {
  const pathname = usePathname();
  const match = /^\/thread\/([^/]+)$/.exec(pathname ?? "");
  return match ? decodeURIComponent(match[1]) : null;
}
