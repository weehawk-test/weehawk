"use client";

import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { useRequireAuth } from "@/contexts/auth-context";

interface AppLayoutProps {
  children: ReactNode;
}

/**
 * Always renders the shell + children so SSR and the first paint match (no full-screen loading swap).
 * useRequireAuth redirects unauthenticated users in the background.
 */
export function AppLayout({ children }: AppLayoutProps) {
  useRequireAuth();
  return (
    <div className="flex min-h-screen bg-background relative overflow-hidden">
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-white/[0.04] rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-white/[0.03] rounded-full blur-[100px] pointer-events-none" />

      <Sidebar />
      <main className="flex-1 ml-64 overflow-y-auto relative z-10 min-h-screen">
        <div className="max-w-6xl mx-auto p-8">{children}</div>
      </main>
    </div>
  );
}
