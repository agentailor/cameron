import React, { useEffect } from "react";
import { PanelLeftOpen, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";

interface SidebarProps {
  isOpen: boolean;
  toggle: () => void;
  children?: React.ReactNode;
  /** Pinned below the scrolling thread list — navigation, status. */
  footer?: React.ReactNode;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, toggle, children, footer }) => {
  // Close sidebar on escape key press
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) toggle();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isOpen, toggle]);

  return (
    <>
      {/* Sidebar */}
      <motion.div
        initial={false}
        animate={{
          x: isOpen ? 0 : -256, // 256px = w-64
          width: isOpen ? 256 : 0,
        }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        className={`border-sidebar-border bg-sidebar fixed top-0 left-0 z-30 h-screen overflow-hidden border-r md:sticky ${
          isOpen ? "flex" : "hidden md:flex"
        }`}
      >
        <div className="flex h-full w-64 shrink-0 flex-col overflow-hidden px-3 py-4">
          <div className="mb-4 flex items-center justify-between px-1.5">
            <Link href="/" className="flex items-center gap-2">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--brand)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M12 3v18M5 8l7-5 7 5" />
              </svg>
              <span className="text-foreground font-mono text-xs font-semibold tracking-[0.12em]">
                CAMERON
              </span>
            </Link>
            <button
              onClick={toggle}
              className="text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer rounded-full p-1.5 transition-colors md:hidden"
              aria-label="Close sidebar"
            >
              <X size={18} />
            </button>
          </div>

          <div className="grow overflow-y-auto">{children}</div>

          {footer && <div className="border-sidebar-border mt-2 border-t pt-2">{footer}</div>}
        </div>
      </motion.div>

      {/* Menu Toggle Button - Only show on mobile */}
      <button
        onClick={toggle}
        className={`fixed top-4 left-4 z-40 cursor-pointer rounded-md p-2 transition-all duration-300 md:hidden ${
          isOpen
            ? "pointer-events-none opacity-0"
            : "border-border bg-card hover:bg-accent border opacity-100 shadow-sm"
        }`}
        aria-label="Toggle navigation"
      >
        <PanelLeftOpen size={18} />
      </button>

      {/* Overlay Background - Only show on mobile */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm md:hidden"
            onClick={toggle}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>
    </>
  );
};

export default Sidebar;
