"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export function AuthPageShell({
  subtitle,
  children,
  /** Wider panel for dense steps (e.g. server deployment choice). */
  wide = false,
}: {
  subtitle: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background relative overflow-hidden px-4 py-12">
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-white/[0.04] rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-white/[0.03] rounded-full blur-[100px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "w-full glass-panel rounded-2xl border border-white/10 shadow-xl relative z-10",
          wide ? "max-w-2xl p-8 sm:p-10" : "max-w-md p-8",
        )}
      >
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="relative w-12 h-12 rounded-xl overflow-hidden border border-primary/20 ring-1 ring-white/5">
            <Image
              src="/weehawk-logo.png"
              alt="Weehawk"
              width={48}
              height={48}
              className="object-cover size-12"
              priority
            />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold tracking-tight">Weehawk</h1>
            <div className="text-sm text-muted-foreground mt-1">{subtitle}</div>
          </div>
        </div>

        {children}
      </motion.div>
    </div>
  );
}
