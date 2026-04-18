"use client";

import { ReactNode, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { SidebarLayoutProvider, useSidebarLayout } from "@/contexts/sidebar-layout-context";
import { useRequireAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";

interface AppLayoutProps {
  children: ReactNode;
}

function PlatformShell({ children }: { children: ReactNode }) {
  const { isMobileNav, mobileNavOpen, closeMobileNav, openMobileNav } = useSidebarLayout();

  return (
    <>
      {isMobileNav && mobileNavOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/45 backdrop-blur-[2px] md:hidden border-0 p-0 w-full h-full cursor-default"
          aria-label="Close menu"
          onClick={closeMobileNav}
        />
      ) : null}
      <Sidebar />
      <main
        className={cn(
          "flex-1 overflow-y-auto relative z-10 min-h-screen transition-[margin-left] duration-200 ease-out",
          "ml-[var(--app-sidebar-width)]",
        )}
      >
        {isMobileNav ? (
          <header className="sticky top-0 z-20 flex min-w-0 items-center border-b border-border/70 bg-background/90 backdrop-blur-md px-2 py-2 md:hidden supports-[backdrop-filter]:bg-background/75 shadow-sm">
            <button
              type="button"
              onClick={openMobileNav}
              className="flex min-w-0 w-full items-center gap-2.5 rounded-xl py-1 pl-1 pr-2 text-left hover:bg-accent/40 active:bg-accent/70 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              aria-expanded={Boolean(isMobileNav && mobileNavOpen)}
              aria-controls="app-sidebar"
              aria-label="Open side menu"
            >
              <div className="relative size-10 shrink-0 overflow-hidden rounded-xl border border-primary/20 bg-card/40 shadow-sm ring-1 ring-border/70 dark:shadow-[0_0_12px_rgba(255,255,255,0.06)] dark:ring-white/5">
                <Image
                  src="/weehawk-logo.svg"
                  alt=""
                  width={40}
                  height={40}
                  className="logo-adaptive object-contain size-10 p-0.5 scale-90"
                  priority
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-foreground text-base tracking-tight leading-tight truncate">
                  Weehawk
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                  <span>Cloud</span>
                  <ChevronLeft
                    className="size-3.5 shrink-0 text-muted-foreground/90"
                    strokeWidth={2.5}
                    aria-hidden
                  />
                </p>
              </div>
            </button>
          </header>
        ) : null}
        <div className="max-w-6xl mx-auto p-8 max-md:px-4 max-md:py-6">{children}</div>
      </main>
    </>
  );
}

/**
 * Unauthenticated users on `/` see {@link SignInPage}; other routes redirect to `/`.
 * When signed in, renders sidebar + main content.
 */
export function AppLayout({ children }: AppLayoutProps) {
  const { isReady, allowed } = useRequireAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isReady || allowed) return;
    const params = new URLSearchParams(
      typeof window !== "undefined" ? window.location.search : "",
    );
    const error = params.get("error")?.trim();
    const dest = error ? `/login?${new URLSearchParams({ error }).toString()}` : "/login";
    router.replace(dest);
  }, [isReady, allowed, router]);

  if (!allowed) {
    return null;
  }

  return (
    <SidebarLayoutProvider>
      <div className="flex min-h-screen bg-background relative overflow-hidden">
        <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/[0.06] dark:bg-white/[0.04] rounded-full blur-[120px] pointer-events-none" />
        <div className="fixed bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-primary/[0.04] dark:bg-white/[0.03] rounded-full blur-[100px] pointer-events-none" />

        <PlatformShell>{children}</PlatformShell>
      </div>
    </SidebarLayoutProvider>
  );
}
