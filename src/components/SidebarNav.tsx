"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Plug } from "lucide-react";
import { RETURN_TO_KEY } from "./BackToChat";

/**
 * Sidebar footer: where Cameron's own pages live, plus a status line. Capabilities sits here
 * rather than in the header — it belongs with navigation, not with the active thread.
 */
export const SidebarNav = ({ onOpenMCPConfig }: { onOpenMCPConfig: () => void }) => {
  const pathname = usePathname();
  const item =
    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors cursor-pointer";

  return (
    <nav className="flex flex-col gap-0.5">
      <Link
        href="/capabilities"
        // Breadcrumb read by BackToChat.
        onClick={() => {
          try {
            if (pathname !== "/capabilities") sessionStorage.setItem(RETURN_TO_KEY, pathname);
          } catch {
            // Blocked storage: BackToChat falls back to `/`.
          }
        }}
        className={`${item} ${
          pathname === "/capabilities"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        }`}
      >
        <LayoutGrid className="h-3.5 w-3.5 shrink-0" />
        capabilities
      </Link>

      <button
        type="button"
        onClick={onOpenMCPConfig}
        className={`${item} text-muted-foreground hover:bg-accent hover:text-foreground text-left`}
      >
        <Plug className="h-3.5 w-3.5 shrink-0" />
        mcp servers
      </button>

      <div className="text-muted-foreground flex items-center gap-2 px-2.5 pt-2 font-mono text-[10px]">
        <span aria-hidden className="bg-term-green block h-1.5 w-1.5 rounded-full" />
        local
      </div>
    </nav>
  );
};
