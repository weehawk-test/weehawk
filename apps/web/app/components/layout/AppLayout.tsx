"use client";

import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { SidebarLayoutProvider, useSidebarLayout } from "@/contexts/sidebar-layout-context";
import { useRequireAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { isOrganizationWorkspacePath } from "@/lib/personal-sidebar-path";
import {
  fetchOrganizations,
  getActiveOrganizationPublicId,
  ORGANIZATIONS_LIST_CHANGED_EVENT,
} from "@/lib/organizations-api";
import { pickDefaultWorkspaceOrganization } from "@/lib/pick-primary-owned-org";

interface AppLayoutProps {
  children: ReactNode;
  initialSidebarCollapsed?: boolean;
  initialMobileNavOpen?: boolean;
}

function PlatformShell({ children }: { children: ReactNode }) {
  const { isMobileNav, mobileNavOpen, closeMobileNav, openMobileNav } = useSidebarLayout();
  const pathname = usePathname();
  const mainScrollRef = useRef<HTMLElement>(null);
  const orgWorkspace = isOrganizationWorkspacePath(pathname);
  const dockerManagerShell = pathname.startsWith("/docker-manager");

  /** Shell stays mounted across routes; the scrollable region is `main`, not the document. */
  useLayoutEffect(() => {
    const el = mainScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname]);

  useEffect(() => {
    if (orgWorkspace && mobileNavOpen) closeMobileNav();
  }, [orgWorkspace, mobileNavOpen, closeMobileNav]);

  const [dockerOrgName, setDockerOrgName] = useState<string>("");
  useEffect(() => {
    if (!dockerManagerShell) {
      setDockerOrgName("");
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const orgs = await fetchOrganizations();
        if (cancelled) return;
        const activeOrgPublicId = (await getActiveOrganizationPublicId())?.trim() ?? "";
        const active =
          (activeOrgPublicId ? orgs.find((o) => o.publicId === activeOrgPublicId) : null) ??
          pickDefaultWorkspaceOrganization(orgs) ??
          null;
        setDockerOrgName(active?.name?.trim() ?? "");
      } catch {
        if (!cancelled) setDockerOrgName("");
      }
    };
    void load();
    const onListChanged = () => {
      void load();
    };
    window.addEventListener(ORGANIZATIONS_LIST_CHANGED_EVENT, onListChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(ORGANIZATIONS_LIST_CHANGED_EVENT, onListChanged);
    };
  }, [dockerManagerShell]);

  return (
    <>
      {!orgWorkspace && isMobileNav ? (
        <button
          type="button"
          className={cn(
            "fixed inset-0 z-30 md:hidden border-0 p-0 w-full h-full cursor-default transition-opacity duration-200",
            mobileNavOpen
              ? "opacity-100 pointer-events-auto bg-black/45 backdrop-blur-[2px]"
              : "opacity-0 pointer-events-none bg-black/0",
          )}
          aria-label="Close menu"
          onClick={closeMobileNav}
        />
      ) : null}
      {!orgWorkspace ? <Sidebar /> : null}
      <main
        ref={mainScrollRef}
        className={cn(
          "relative z-10 min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain transition-[margin-left] duration-200 ease-out [scrollbar-gutter:stable]",
          orgWorkspace
            ? "max-md:ml-0 md:ml-[var(--app-sidebar-width)]"
            : "ml-[var(--app-sidebar-width)] max-md:ml-0",
        )}
      >
        {!orgWorkspace && !(isMobileNav && mobileNavOpen) ? (
          dockerManagerShell ? (
            <header className="sticky top-0 z-[40] flex w-full min-w-0 items-center gap-2 border-b border-border/70 bg-background/90 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top,0px))] backdrop-blur-md supports-[backdrop-filter]:bg-background/75 md:hidden">
              <button
                type="button"
                onClick={openMobileNav}
                className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-card/50 text-foreground transition-colors hover:bg-accent/70"
                aria-expanded={Boolean(isMobileNav && mobileNavOpen)}
                aria-controls="app-sidebar"
                aria-label="Open side menu"
              >
                <Menu className="size-5" />
              </button>
              <div className="relative size-9 shrink-0 overflow-hidden rounded-lg border border-primary/20 bg-card/40 shadow-sm ring-1 ring-border/70 dark:ring-white/5">
                <Image
                  src="/weehawk-logo.svg"
                  alt=""
                  width={36}
                  height={36}
                  className="logo-adaptive size-9 scale-90 object-contain p-0.5"
                  priority
                />
              </div>
              <div className="min-w-0 flex-1 py-0.5">
                <p className="truncate text-base font-bold leading-tight tracking-tight text-foreground">
                  Weehawk
                </p>
                {dockerOrgName ? (
                  <p className="mt-0.5 truncate text-xs font-medium leading-snug text-muted-foreground">
                    {dockerOrgName}
                  </p>
                ) : null}
              </div>
            </header>
          ) : (
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
                  <p className="mt-0.5 font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
                    Menu
                  </p>
                </div>
              </button>
            </header>
          )
        ) : null}
        {orgWorkspace ? (
          children
        ) : (
          <div className="max-w-6xl mx-auto p-8 max-md:px-4 max-md:py-6">{children}</div>
        )}
      </main>
    </>
  );
}

/**
 * Unauthenticated users on `/` see {@link SignInPage}; other routes redirect to `/`.
 * When signed in, renders sidebar + main content.
 */
export function AppLayout({
  children,
  initialSidebarCollapsed = false,
  initialMobileNavOpen = false,
}: AppLayoutProps) {
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
    <SidebarLayoutProvider
      initialCollapsed={initialSidebarCollapsed}
      initialMobileNavOpen={initialMobileNavOpen}
    >
      <div className="relative flex h-[100dvh] min-h-0 w-full overflow-hidden bg-background">
        <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/[0.06] dark:bg-white/[0.04] rounded-full blur-[120px] pointer-events-none" />
        <div className="fixed bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-primary/[0.04] dark:bg-white/[0.03] rounded-full blur-[100px] pointer-events-none" />

        <PlatformShell>{children}</PlatformShell>
      </div>
    </SidebarLayoutProvider>
  );
}
