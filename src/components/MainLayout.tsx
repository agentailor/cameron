"use client";
import { ReactNode, useCallback, useEffect, useState } from "react";
import { ThreadList } from "./ThreadList";
import Sidebar from "./Sidebar";
import Header from "./Header";
import { MCPServerList } from "./MCPServerList";
import { SidebarNav } from "./SidebarNav";

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  // Open by default on desktop; on mobile the sidebar is an overlay, so starting open would
  // cover the thread behind a scrim. Resolved after mount to keep SSR and hydration identical.
  const [isSidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) setSidebarOpen(false);
  }, []);
  const [showMCPConfig, setShowMCPConfig] = useState(false);
  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);
  const openMCPConfig = useCallback(() => setShowMCPConfig(true), []);
  const closeMCPConfig = useCallback(() => setShowMCPConfig(false), []);

  return (
    <div className="bg-background flex h-screen overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        isOpen={isSidebarOpen}
        toggle={toggleSidebar}
        footer={<SidebarNav onOpenMCPConfig={openMCPConfig} />}
      >
        <ThreadList />
      </Sidebar>

      {/* Main content area */}
      <div className="bg-background flex min-w-0 flex-1 flex-col">
        <div className="z-10">
          <Header toggleSidebar={toggleSidebar} isSidebarOpen={isSidebarOpen} />
        </div>

        {/* Main content */}
        <div className="relative h-[calc(100vh-4rem)] flex-1">{children}</div>
      </div>

      {/* MCP Configuration Modal */}
      <MCPServerList isOpen={showMCPConfig} onClose={closeMCPConfig} />
    </div>
  );
}
