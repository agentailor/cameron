import React from "react";
import { PanelLeftClose } from "lucide-react";
import Link from "next/link";

interface HeaderProps {
  toggleSidebar: () => void;
}
export const Header = ({ toggleSidebar }: HeaderProps) => {
  return (
    <header className="sticky top-0 z-10 flex items-center px-4 py-3">
      <div className="flex w-full items-center justify-between">
        <div className="flex items-center">
          <button
            onClick={toggleSidebar}
            className="text-muted-foreground hover:bg-muted hover:text-foreground mr-4 cursor-pointer rounded-md p-2 transition-colors"
            aria-label="Toggle navigation"
          >
            <PanelLeftClose size={25} />
          </button>

          <div className="flex items-center">
            <Link href="/" className="flex items-center">
              <span className="text-foreground hidden text-xl font-semibold sm:block">
                Cameron AI
              </span>
            </Link>
          </div>
        </div>

        <Link
          href="/capabilities"
          className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md px-3 py-2 text-sm transition-colors"
        >
          Capabilities
        </Link>
      </div>
    </header>
  );
};

export default Header;
