"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

export function OnboardingPageShell({
  subtitle,
  children,
  wide = false,
  /** Slightly smaller padding and type (self-hosted install wizard only). */
  cozy = false,
}: {
  subtitle: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
  cozy?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-h-screen flex flex-col items-center justify-center bg-background relative overflow-hidden px-4",
        cozy ? "py-10" : "py-12",
      )}
    >
      <div className="fixed top-4 right-4 z-20">
        <ThemeToggle />
      </div>
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/[0.06] dark:bg-white/[0.04] rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-primary/[0.04] dark:bg-white/[0.03] rounded-full blur-[100px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "w-full glass-panel rounded-2xl border border-border shadow-xl relative z-10",
          wide && cozy && "max-w-2xl p-6 sm:p-8",
          wide && !cozy && "max-w-2xl p-8 sm:p-10",
          !wide && cozy && "max-w-md p-6 sm:p-7",
          !wide && !cozy && "max-w-md p-8",
        )}
      >
        <div className={cn("flex flex-col items-center", cozy ? "gap-2.5 mb-6" : "gap-3 mb-8")}>
          <div
            className={cn(
              "relative rounded-xl overflow-hidden border border-primary/20 ring-1 ring-border/60 dark:ring-white/5",
              cozy ? "w-11 h-11" : "w-12 h-12",
            )}
          >
            <Image
              src="/weehawk-logo.svg"
              alt="Weehawk"
              width={cozy ? 44 : 48}
              height={cozy ? 44 : 48}
              className={cn(
                "logo-adaptive object-contain p-0.5 scale-90",
                cozy ? "size-11" : "size-12",
              )}
              priority
            />
          </div>
          <div className="text-center">
            <h1 className={cn("font-bold tracking-tight", cozy ? "text-lg" : "text-xl")}>Weehawk</h1>
            <div className={cn("text-muted-foreground mt-1", cozy ? "text-xs sm:text-sm" : "text-sm")}>
              {subtitle}
            </div>
          </div>
        </div>

        {children}
      </motion.div>
    </div>
  );
}
