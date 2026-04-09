"use client";

import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { SidebarLayoutProvider } from "@/contexts/sidebar-layout-context";

interface AppLayoutProps {
  children: ReactNode;
}

/**
 * Unauthenticated users on `/` see {@link SignInPage}; other routes redirect to `/`.
 * When signed in, renders sidebar + main content.
 */
export function AppLayout({ children }: AppLayoutProps) {
  return (
    <SidebarLayoutProvider>
      <div className="flex min-h-screen bg-background relative overflow-hidden">
        <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/[0.06] dark:bg-white/[0.04] rounded-full blur-[120px] pointer-events-none" />
        <div className="fixed bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-primary/[0.04] dark:bg-white/[0.03] rounded-full blur-[100px] pointer-events-none" />

        <Sidebar />
        <main className="flex-1 overflow-y-auto relative z-10 min-h-screen ml-[var(--app-sidebar-width)] transition-[margin-left] duration-200 ease-out">
          <div className="max-w-6xl mx-auto p-8">{children}</div>
        </main>
      </div>
    </SidebarLayoutProvider>
  );
}
