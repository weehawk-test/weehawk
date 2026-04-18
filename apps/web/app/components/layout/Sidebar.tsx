"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  Webhook, FolderKanban, KeyRound, ChevronLeft, ChevronRight,
  ImageIcon, Box, Database, Bell, HardDrive, Network, Boxes, ShieldCheck, Clock3,
  GitBranch, Server, Mail, Globe, Newspaper, LogOut, UserCog, ChevronDown, X,
} from "lucide-react";
import { motion, LayoutGroup } from "framer-motion";
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
import type { LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function buildDockerNavItems(base: string): { href: string; label: string; icon: LucideIcon }[] {
  return [
    { href: `${base}/images`, label: "Images", icon: ImageIcon },
    { href: `${base}/containers`, label: "Containers", icon: Box },
    { href: `${base}/services`, label: "Services", icon: Boxes },
    { href: `${base}/networks`, label: "Networks", icon: Network },
    { href: `${base}/secrets`, label: "Secrets", icon: KeyRound },
    { href: `${base}/volumes`, label: "Volumes", icon: Database },
  ];
}

type MainNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Opens in a new tab (docs, contact, etc.). */
  external?: boolean;
};

type MainNavSection = {
  label: string;
  items: MainNavItem[];
};

function buildMainNavSections(): MainNavSection[] {
  return [
    {
      label: "General",
      items: [
        { href: "/", label: "Projects", icon: FolderKanban },
        { href: "/remote-server", label: "Servers", icon: Server },
        { href: "/domains", label: "Domains", icon: Globe },
      ],
    },
    {
      label: "Integrations",
      items: [
        { href: "/webhooks", label: "Webhooks", icon: Webhook },
        { href: "/cron-jobs", label: "Cron Jobs", icon: Clock3 },
        { href: "/notifications/channels", label: "Notifications", icon: Bell },
        { href: "/s3", label: "S3 Destinations", icon: HardDrive },
      ],
    },
    {
      label: "Registry & Git",
      items: [
        { href: "/registry", label: "Registry", icon: ShieldCheck },
        { href: "/git", label: "Git", icon: GitBranch },
      ],
    },
    {
      label: "More",
      items: [
        { href: "/news", label: "News", icon: Newspaper },
        {
          href: "https://weehawk.io/contact",
          label: "Contact us",
          icon: Mail,
          external: true,
        },
      ],
    },
  ];
}

function NavRow({
  collapsed,
  href,
  label,
  active,
  icon: Icon,
  activeLayoutId,
  external,
  showUnreadDot,
}: {
  collapsed: boolean;
  href: string;
  label: string;
  active: boolean;
  icon: LucideIcon;
  activeLayoutId: string;
  external?: boolean;
  /** Red badge (e.g. new platform news). */
  showUnreadDot?: boolean;
}) {
  const className = cn(
    "relative flex items-center rounded-xl transition-colors duration-200 group",
    collapsed ? "justify-center px-2 py-2" : "gap-3 px-4 py-2",
    active
      ? "text-violet-800 dark:text-primary"
      : "text-foreground/90 hover:text-foreground hover:bg-accent/70",
  );

  const inner = (
    <>
      {active && !external && (
        <motion.div
          layoutId={activeLayoutId}
          className={cn(
            "absolute inset-0 rounded-xl border",
            "bg-violet-500/[0.12] border-violet-500/30",
            "dark:bg-primary/10 dark:border-primary/20",
          )}
          initial={false}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
        />
      )}
      <span className="relative z-10 inline-flex flex-shrink-0">
        <Icon
          className={cn(
            "w-4 h-4",
            active
              ? "text-violet-700 dark:text-primary"
              : "text-foreground/90 group-hover:text-foreground",
          )}
        />
        {showUnreadDot ? (
          <span
            className="absolute -right-1 -top-1 size-2 rounded-full bg-red-500 ring-2 ring-card dark:ring-zinc-950"
            aria-hidden
          />
        ) : null}
      </span>
      {!collapsed && (
        <span className="font-medium relative z-10 text-sm min-w-0 break-words leading-snug">{label}</span>
      )}
    </>
  );

  const link =
    external ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {inner}
      </a>
    ) : (
      <Link href={href} scroll={false} className={className}>
        {inner}
      </Link>
    );

  if (collapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {label}
          {showUnreadDot ? (
            <span className="block text-[10px] text-red-400 mt-0.5">New items</span>
          ) : null}
          {external ? <span className="block text-[10px] text-muted-foreground mt-0.5">Opens in new tab</span> : null}
        </TooltipContent>
      </Tooltip>
    );
  }

  return link;
}

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
    if (href === "/notifications/channels") return location.startsWith("/notifications");
    if (href === "/registry") {
      return location === "/registry" || location.startsWith("/registry/");
    }
    if (href === "/git") {
      return location === "/git" || location.startsWith("/git/");
    }
    if (href === "/remote-server") {
      return location === "/remote-server" || location.startsWith("/remote-server/");
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
        "border-r border-border bg-card/30 backdrop-blur-xl fixed top-0 left-0 h-screen flex flex-col z-40 overflow-x-hidden",
        isMobileNav
          ? cn(
              "w-[min(20rem,calc(100vw-1.5rem))] transition-transform duration-200 ease-out shadow-2xl",
              mobileNavOpen ? "translate-x-0" : "-translate-x-full",
            )
          : "w-[var(--app-sidebar-width)] transition-[width] duration-200 ease-out",
      )}
      aria-hidden={isMobileNav && !mobileNavOpen ? true : undefined}
    >
      {/* Logo + collapse toggle */}
      <div className={cn("flex-shrink-0 pt-7 pb-1.5", railMode ? "px-2" : "px-6 max-md:px-4")}>
        {!railMode ? (
          <div className="flex items-start gap-2 min-w-0">
            <Link
              href={isConsoleServerSidebar ? consoleLogoHref : "/"}
              scroll={false}
              className="flex items-start gap-3 flex-1 min-w-0 rounded-xl -mx-1 px-1 py-0.5 hover:bg-accent/60 transition-colors"
            >
              <div className="relative w-10 h-10 rounded-xl overflow-hidden border border-primary/20 shadow-sm flex-shrink-0 ring-1 ring-border/70 dark:shadow-[0_0_15px_rgba(255,255,255,0.08)] dark:ring-white/5">
                <Image
                  src="/weehawk-logo.svg"
                  alt="Weehawk"
                  width={40}
                  height={40}
                  className="logo-adaptive object-contain size-10 p-0.5 scale-90"
                  priority
                />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <h1 className="font-bold text-lg text-foreground tracking-tight leading-none truncate">
                  Weehawk
                </h1>
                <p className="text-[10px] text-muted-foreground tracking-widest uppercase font-mono mt-1">
                  CLOUD
                </p>
              </div>
            </Link>
            <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
              <ThemeToggle />
              {isMobileNav ? (
                <button
                  type="button"
                  onClick={closeMobileNav}
                  aria-label="Close menu"
                  className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/80 shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={toggle}
                  aria-label="Collapse sidebar"
                  className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/80 shrink-0"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2.5">
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
            <ThemeToggle iconOnly />
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={toggle}
                  aria-label="Expand sidebar"
                  className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/80"
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
                    {section.items.map((item) => {
                      const active = item.external ? false : isActive(item.href);
                      return (
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
                        />
                      );
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
      <div className="flex-shrink-0 border-t border-border p-2.5">
        <DropdownMenu open={profileMenuOpen} onOpenChange={setProfileMenuOpen}>
          <DropdownMenuTrigger asChild>
            {railMode ? (
              <button
                type="button"
                className="w-full flex justify-center items-center px-2 py-2 rounded-xl hover:bg-accent/70 data-[state=open]:bg-accent/80 transition-colors outline-none focus-visible:outline-none focus-visible:ring-0"
                aria-label="Open user menu"
              >
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/20 to-muted/40 border border-primary/20 flex items-center justify-center flex-shrink-0">
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
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-accent/70 data-[state=open]:bg-accent/80 transition-colors outline-none focus-visible:outline-none focus-visible:ring-0"
                aria-label="Open user menu"
              >
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/20 to-muted/40 border border-primary/20 flex items-center justify-center flex-shrink-0">
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
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm font-semibold text-foreground leading-tight truncate">{displayName}</p>
                  <p className="text-xs text-muted-foreground mt-1 truncate">{displayEmail}</p>
                </div>
                <ChevronDown
                  className={cn(
                    "w-4 h-4 text-muted-foreground transition-transform duration-200",
                    profileMenuOpen && "rotate-180",
                  )}
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

