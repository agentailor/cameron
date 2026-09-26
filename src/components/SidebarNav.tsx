"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Plug, Settings, type LucideIcon } from "lucide-react";
import { RETURN_TO_KEY } from "./BackToChat";

const ITEMS: { href: string; label: string; Icon: LucideIcon }[] = [
  { href: "/capabilities", label: "capabilities", Icon: LayoutGrid },
  { href: "/connections", label: "connections", Icon: Plug },
  { href: "/settings", label: "settings", Icon: Settings },
];

/**
 * Sidebar footer: where Cameron's own pages live, plus a status line. Capabilities sits here
 * rather than in the header — it belongs with navigation, not with the active thread.
 */
export const SidebarNav = () => {
  const pathname = usePathname();
  const item =
    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors cursor-pointer";

  return (
    <nav className="flex flex-col gap-0.5">
      {ITEMS.map(({ href, label, Icon }) => (
        <Link
          key={href}
          href={href}
          // Breadcrumb read by BackToChat.
          onClick={() => {
            try {
              if (pathname !== href) sessionStorage.setItem(RETURN_TO_KEY, pathname);
            } catch {
              // Blocked storage: BackToChat falls back to `/`.
            }
          }}
          className={`${item} ${
            pathname === href
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <Icon className="h-3.5 w-3.5 shrink-0" />
          {label}
        </Link>
      ))}

      <div className="text-muted-foreground flex items-center gap-2 px-2.5 pt-2 font-mono text-[10px]">
        <span aria-hidden className="bg-term-green block h-1.5 w-1.5 rounded-full" />
        local
      </div>
    </nav>
  );
};
