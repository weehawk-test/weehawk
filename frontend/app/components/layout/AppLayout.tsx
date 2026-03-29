"use client";

import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { motion } from "framer-motion";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="flex min-h-screen bg-background relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-white/[0.04] rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-white/[0.03] rounded-full blur-[100px] pointer-events-none" />
      
      <Sidebar />
      <main className="flex-1 ml-64 overflow-y-auto relative z-10 min-h-screen">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.3 }}
          className="max-w-6xl mx-auto p-8"
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}
