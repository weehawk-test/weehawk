"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRight, PanelLeft, Server, LogOut, UserCog, ChevronDown, X, Settings } from "lucide-react";
import { LayoutGroup } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useSidebarLayout } from "@/contexts/sidebar-layout-context";
import {
  PLATFORM_NEWS_FETCH_URL,
  type PlatformNewsItem,
} from "@/(platform)/news/platform-news";
import {
  newsFeedHasUnread,
  PLATFORM_NEWS_SEEN_EVENT,
  PLATFORM_NEWS_SEEN_STORAGE_KEY,
} from "@/lib/platform-news-read";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NavRow } from "./sidebar-nav-row";
import { buildMainNavSections, buildDockerNavItems } from "./main-nav-sections";
import { fetchOrganizations } from "@/lib/organizations-api";
import type { OrganizationPublic } from "@/lib/organizations-types";
import { pickDefaultWorkspaceOrganization } from "@/lib/pick-primary-owned-org";
import { firstOrgManagementPathSegment } from "@/lib/org-workspace-permissions";
import { isOrgManagementSectionActive, ORGANIZATION_MANAGEMENT_BASE } from "@/lib/org-nav-utils";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProfileThemeMenuItems } from "./profile-theme-menu-items";
import { WorkspaceSwitcher } from "./workspace-switcher";

export function Sidebar() {
  const { collapsed, toggle, isMobileNav, mobileNavOpen, closeMobileNav } = useSidebarLayout();
  /** Icon-only rail on desktop when collapsed; on phone the drawer is always full labels. */
  const railMode = collapsed && !isMobileNav;
  const { user, logout } = useAuth();
  const router = useRouter();
  const location = usePathname();
  const layoutGroupId = "sidebar-nav-main";
  const activeLayoutId = "active-nav-main";
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  const nameParts = [user?.firstName?.trim(), user?.lastName?.trim()].filter(Boolean);
  const displayName = nameParts.length > 0 ? nameParts.join(" ") : user?.email ?? "Weehawk User";
  const displayEmail = user?.email ?? "No email";
  const avatarUrl = user?.imageUrl?.trim() ? user.imageUrl : null;
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "WU";

  const mainNavSections = useMemo(() => buildMainNavSections(), []);
  const [newsUnread, setNewsUnread] = useState(false);
  const [myOrganizations, setMyOrganizations] = useState<OrganizationPublic[]>([]);

  useEffect(() => {
    if (!user?.userId) {
      setNewsUnread(false);
      return;
    }

    let cancelled = false;

    async function refreshNewsUnread() {
      try {
        const res = await fetch(PLATFORM_NEWS_FETCH_URL, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data: unknown = await res.json();
        if (!Array.isArray(data) || cancelled) return;
        setNewsUnread(newsFeedHasUnread(data as PlatformNewsItem[]));
      } catch {
        if (!cancelled) setNewsUnread(false);
      }
    }

    void refreshNewsUnread();
    const onSeen = () => setNewsUnread(false);
    const onStorage = (e: StorageEvent) => {
      if (e.key === PLATFORM_NEWS_SEEN_STORAGE_KEY) {
        setNewsUnread(false);
      }
    };
    window.addEventListener(PLATFORM_NEWS_SEEN_EVENT, onSeen);
    window.addEventListener("storage", onStorage);

    return () => {
      cancelled = true;
      window.removeEventListener(PLATFORM_NEWS_SEEN_EVENT, onSeen);
      window.removeEventListener("storage", onStorage);
    };
  }, [user?.userId]);

  useEffect(() => {
    if (!user?.userId) {
      queueMicrotask(() => setMyOrganizations([]));
      return;
    }
    let cancelled = false;
    void fetchOrganizations()
      .then((list) => {
        if (!cancelled) setMyOrganizations(list);
      })
      .catch(() => {
        if (!cancelled) setMyOrganizations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.userId]);

  useEffect(() => {
    closeMobileNav();
  }, [location, closeMobileNav]);

  const consoleMatch = /^\/docker-manager\/([^/]+)/.exec(location);
  const consoleNavBase =
    consoleMatch != null
      ? `/docker-manager/${consoleMatch[1]}`
      : null;
  const dockerNavDynamic =
    consoleNavBase != null ? buildDockerNavItems(consoleNavBase) : [];

  const dockerShell =
    /^\/docker-manager\/[^/]+/.test(location) ||
    location === "/secrets" ||
    location.startsWith("/secrets/");

  /** Under `/docker-manager/:id/...` show only Docker nav for that server (not General / Integrations / …). */
  const isConsoleServerSidebar = /^\/docker-manager\/[^/]+/.test(location);
  const consoleLogoHref =
    consoleNavBase != null ? `${consoleNavBase}/images` : "/";

  const isActive = (href: string) => {
    if (href === "/") {
      return location === "/" || location === "/projects" || location.startsWith("/projects/");
    }
    if (href === "/notifications") return location.startsWith("/notifications");
    if (href === "/registry") {
      return location === "/registry" || location.startsWith("/registry/");
    }
    if (href === "/git") {
      return location === "/git" || location.startsWith("/git/");
    }
    if (href === "/remote-server") {
      return location === "/remote-server" || location.startsWith("/remote-server/");
    }
    if (href === "/organization") {
      return isOrgManagementSectionActive(location, "");
    }
    if (href.includes("/secrets")) {
      if (location === href || location.startsWith(`${href}/`)) return true;
      return false;
    }
    return location.startsWith(href);
  };

  const handleEditProfile = () => {
    setProfileMenuOpen(false);
    router.push("/profile");
  };

  const handleLogout = async () => {
    setProfileMenuOpen(false);
    await logout();
    router.replace("/login");
  };

  return (
    <aside
      id="app-sidebar"
      className={cn(
        "fixed left-0 top-0 z-40 flex min-h-0 min-w-0 flex-col overflow-x-hidden border-border",
        /* Opaque panel on phone: translucent + blur composites inconsistently over the scrim (iOS). */
        isMobileNav
          ? cn(
              "bg-card h-[100dvh] max-h-[100dvh] w-[min(20rem,calc(100vw_-_1rem))] max-w-[calc(100vw_-_1rem)] pt-[env(safe-area-inset-top,0px)] transition-transform duration-200 ease-out border-r-0",
              mobileNavOpen ? "translate-x-0 shadow-2xl" : "-translate-x-[calc(100%+2px)] shadow-none",
            )
          : "h-screen w-[var(--app-sidebar-width)] max-md:hidden bg-card/30 backdrop-blur-xl transition-[width] duration-200 ease-out border-r",
      )}
      aria-hidden={isMobileNav && !mobileNavOpen ? true : undefined}
    >
      {/* Logo + collapse toggle */}
      <div className={cn("flex-shrink-0 pt-7 pb-1.5", railMode ? "px-2" : "px-6 max-md:px-4")}>
        {!railMode ? (
          <div className="flex min-w-0 items-start gap-2">
            <Link
              href={isConsoleServerSidebar ? consoleLogoHref : "/"}
              scroll={false}
              className="relative size-10 shrink-0 self-center overflow-hidden rounded-xl border border-primary/20 shadow-sm ring-1 ring-border/70 outline-none ring-offset-background transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:shadow-[0_0_15px_rgba(255,255,255,0.08)] dark:ring-white/5"
            >
              <Image
                src="/weehawk-logo.svg"
                alt=""
                width={40}
                height={40}
                className="logo-adaptive size-10 scale-90 object-contain p-0.5"
                priority
              />
            </Link>
            <WorkspaceSwitcher className="min-w-0 flex-1" onNavigate={closeMobileNav} />
            <div className="flex shrink-0 items-center gap-0.5">
              {isMobileNav ? (
                <button
                  type="button"
                  onClick={closeMobileNav}
                  aria-label="Close menu"
                  className="rounded-lg p-1.5 text-foreground hover:bg-accent/80 shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={toggle}
                  aria-label="Collapse sidebar"
                  className="rounded-lg p-1.5 text-foreground hover:bg-accent/80 shrink-0"
                >
                  <PanelLeft className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2.5">
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Link
                  href={isConsoleServerSidebar ? consoleLogoHref : "/"}
                  scroll={false}
                  className="flex justify-center rounded-xl p-1 hover:bg-accent/60 transition-colors"
                >
                  <div className="relative w-10 h-10 rounded-xl overflow-hidden border border-primary/20 shadow-sm ring-1 ring-border/70 dark:shadow-[0_0_15px_rgba(255,255,255,0.08)] dark:ring-white/5">
                    <Image
                      src="/weehawk-logo.svg"
                      alt="Weehawk"
                      width={40}
                      height={40}
                      className="logo-adaptive object-contain size-10 p-0.5 scale-90"
                      priority
                    />
                  </div>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {displayName}
              </TooltipContent>
            </Tooltip>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={toggle}
                  aria-label="Expand sidebar"
                  className="rounded-lg p-1.5 text-foreground hover:bg-accent/80"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                Expand sidebar
              </TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>

      {/* Scrollable nav */}
      <nav className={cn("flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-3", railMode ? "px-2" : "px-4 max-md:px-3")}>
        <LayoutGroup id={layoutGroupId}>
          {isConsoleServerSidebar ? (
            <>
              <div className={cn("mb-1.5", railMode && "mt-4")}>
                {!railMode && (
                  <p className="text-[10px] text-muted-foreground/80 tracking-widest uppercase font-mono px-4 mb-0.5 mt-4">
                    General
                  </p>
                )}
                <div className="space-y-px">
                  <NavRow
                    collapsed={railMode}
                    href="/remote-server"
                    label="Servers"
                    active={isActive("/remote-server")}
                    icon={Server}
                    activeLayoutId={activeLayoutId}
                  />
                </div>
              </div>
              <div className="mb-1.5">
                {!railMode && (
                  <p className="text-[10px] text-muted-foreground/80 tracking-widest uppercase font-mono px-4 mb-0.5 mt-3">
                    Docker
                  </p>
                )}
                <div className="space-y-px">
                  {dockerNavDynamic.map((item) => {
                    const active = isActive(item.href);
                    return (
                      <NavRow
                        key={item.href}
                        collapsed={railMode}
                        href={item.href}
                        label={item.label}
                        active={active}
                        icon={item.icon}
                        activeLayoutId={activeLayoutId}
                      />
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <>
              {mainNavSections.map((section, sectionIndex) => (
                <div
                  key={section.label}
                  className={cn(
                    "mb-1.5",
                    railMode && sectionIndex > 0 && "mt-1.5",
                    railMode && sectionIndex === 0 && "mt-4",
                  )}
                >
                  {!railMode && (
                    <p
                      className={`text-[10px] text-muted-foreground/80 tracking-widest uppercase font-mono px-4 mb-0.5 ${
                        sectionIndex === 0 ? "mt-4" : "mt-3"
                      }`}
                    >
                      {section.label}
                    </p>
                  )}
                  <div className="space-y-px">
                    {section.items.flatMap((item) => {
                      if (item.orgManagementEntry) {
                        const primary = pickDefaultWorkspaceOrganization(myOrganizations);
                        if (!primary) return [];
                        const mgmtSeg = firstOrgManagementPathSegment(
                          primary.workspacePermissions,
                          primary.isOwner,
                        );
                        const href = `${ORGANIZATION_MANAGEMENT_BASE}/${mgmtSeg}`;
                        const active = isOrgManagementSectionActive(location, "");
                        return [
                          <NavRow
                            key={`${item.href}-personal-mgmt`}
                            collapsed={railMode}
                            href={href}
                            label="Management"
                            active={active}
                            icon={Settings}
                            activeLayoutId={activeLayoutId}
                            showUnreadDot={false}
                          />,
                        ];
                      }
                      const active = item.external ? false : isActive(item.href);
                      return [
                        <NavRow
                          key={item.href}
                          collapsed={railMode}
                          href={item.href}
                          label={item.label}
                          active={active}
                          icon={item.icon}
                          activeLayoutId={activeLayoutId}
                          external={item.external}
                          showUnreadDot={item.href === "/news" && newsUnread}
                        />,
                      ];
                    })}
                  </div>
                </div>
              ))}

              {dockerNavDynamic.length > 0 ? (
                <div className="mb-1.5">
                  {!railMode && (
                    <p className="text-[10px] text-muted-foreground/80 tracking-widest uppercase font-mono px-4 mb-0.5 mt-3">
                      Docker
                    </p>
                  )}
                  <div className="space-y-px">
                    {dockerNavDynamic.map((item) => {
                      const active = isActive(item.href);
                      return (
                        <NavRow
                          key={item.href}
                          collapsed={railMode}
                          href={item.href}
                          label={item.label}
                          active={active}
                          icon={item.icon}
                          activeLayoutId={activeLayoutId}
                        />
                      );
                    })}
                  </div>
                </div>
              ) : dockerShell && consoleNavBase == null ? (
                <div className="mb-1.5">
                  {railMode ? (
                    <Tooltip delayDuration={0}>
                      <TooltipTrigger asChild>
                        <Link
                          href="/remote-server"
                          className="flex justify-center p-2.5 rounded-xl text-primary hover:bg-accent/70"
                          aria-label="Add a remote server"
                        >
                          <Server className="w-5 h-5" />
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={8} className="max-w-[220px]">
                        Add an SSH host under Remote servers to open the Docker console for that machine.
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <p className="px-4 py-1.5 text-xs text-foreground/90 leading-relaxed">
                      Add an SSH host under{" "}
                      <Link href="/remote-server" className="text-primary hover:underline">
                        Remote servers
                      </Link>{" "}
                      to open the Docker console for that machine.
                    </p>
                  )}
                </div>
              ) : null}
            </>
          )}
        </LayoutGroup>
      </nav>

      {/* Local user label (no auth session) */}
      <div
        className={cn(
          "flex-shrink-0 border-t border-border p-2.5",
          isMobileNav &&
            "pb-[max(0.625rem,env(safe-area-inset-bottom,0px))] pl-[max(0.625rem,env(safe-area-inset-left,0px))] pr-[max(0.625rem,env(safe-area-inset-right,0px))]",
        )}
      >
        <DropdownMenu modal={false} open={profileMenuOpen} onOpenChange={setProfileMenuOpen}>
          <DropdownMenuTrigger asChild>
            {railMode ? (
              <button
                type="button"
                className="flex w-full min-w-0 items-center justify-center rounded-xl px-2 py-2 outline-none transition-colors hover:bg-accent/70 data-[state=open]:bg-accent/80 focus-visible:outline-none focus-visible:ring-0"
                aria-label="Open user menu"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-gradient-to-br from-primary/20 to-muted/40">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={displayName}
                      className="h-full w-full rounded-xl object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="text-xs font-bold text-primary tracking-tight">{initials}</span>
                  )}
                </div>
              </button>
            ) : (
              <button
                type="button"
                className="flex w-full min-w-0 max-w-full items-center gap-2 rounded-xl px-2 py-2 text-left outline-none transition-colors hover:bg-accent/70 data-[state=open]:bg-accent/80 focus-visible:outline-none focus-visible:ring-0 sm:gap-3 sm:px-3"
                aria-label="Open user menu"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-gradient-to-br from-primary/20 to-muted/40 max-[380px]:h-8 max-[380px]:w-8">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={displayName}
                      className="h-full w-full rounded-xl object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="text-xs font-bold text-primary tracking-tight">{initials}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1 overflow-hidden text-left">
                  <p className="truncate text-sm font-semibold leading-tight text-foreground">{displayName}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{displayEmail}</p>
                </div>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-foreground transition-transform duration-200",
                    profileMenuOpen && "rotate-180",
                  )}
                  aria-hidden
                />
              </button>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={railMode ? "right" : "top"}
            align={railMode ? "start" : "end"}
            sideOffset={8}
            className={cn(
              "rounded-2xl border-border/60 p-2 shadow-2xl data-[state=open]:duration-300 data-[state=closed]:duration-200",
              railMode ? "w-56" : "w-[var(--radix-dropdown-menu-trigger-width)]",
            )}
          >
            <div className="px-2.5 py-2">
              <p className="text-base font-semibold leading-tight truncate">{displayName}</p>
              <p className="text-sm text-muted-foreground mt-1 truncate">{displayEmail}</p>
            </div>
            <DropdownMenuItem onSelect={handleEditProfile}>
              <UserCog className="w-4 h-4" />
              Edit profile
            </DropdownMenuItem>
            <ProfileThemeMenuItems />
            <DropdownMenuItem
              onSelect={() => void handleLogout()}
              className="text-red-600 dark:text-red-400 focus:text-red-700 dark:focus:text-red-300 focus:bg-red-500/10"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

