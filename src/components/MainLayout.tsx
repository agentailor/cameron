"use client";
import { ReactNode, useCallback, useEffect, useState } from "react";
import { ThreadList } from "./ThreadList";
import Sidebar from "./Sidebar";
import Header from "./Header";
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
  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);

  return (
    <div className="bg-background flex h-screen overflow-hidden">
      {/* Sidebar */}
      <Sidebar isOpen={isSidebarOpen} toggle={toggleSidebar} footer={<SidebarNav />}>
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
    </div>
  );
}
