import React from "react";
import { PanelLeft, PanelLeftOpen } from "lucide-react";

interface HeaderProps {
  toggleSidebar: () => void;
  isSidebarOpen?: boolean;
}

/**
 * Thin bar over the thread. The wordmark lives in the sidebar, so this only carries the
 * sidebar toggle — the thread's own title is rendered by the page below it.
 */
export const Header = ({ toggleSidebar, isSidebarOpen = true }: HeaderProps) => {
  return (
    <header className="sticky top-0 z-10 flex items-center px-3 py-2.5">
      <button
        onClick={toggleSidebar}
        className="text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer rounded-md p-2 transition-colors"
        aria-label={isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
        aria-expanded={isSidebarOpen}
      >
        {isSidebarOpen ? <PanelLeft size={18} /> : <PanelLeftOpen size={18} />}
      </button>
    </header>
  );
};

export default Header;
