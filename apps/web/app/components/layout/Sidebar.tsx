"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  Webhook, FolderKanban, KeyRound, UserCircle, ChevronUp, ChevronLeft, ChevronRight,
  ImageIcon, Box, Database, Bell, HardDrive, Network, Boxes, ShieldCheck, Clock3,
  GitBranch, Globe, Server, CreditCard, BookOpen, LifeBuoy,
} from "lucide-react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { useSidebarLayout } from "@/contexts/sidebar-layout-context";
import { fetchSetupStatus } from "@/lib/auth-api";
import { editionFromEnv, isCloudEdition } from "@/lib/weehawk-edition";
import type { LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

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
  /** Opens in a new tab (docs, support, etc.). */
  external?: boolean;
};

type MainNavSection = {
  label: string;
  items: MainNavItem[];
};

function buildMainNavSections(cloudEdition: boolean): MainNavSection[] {
  return [
    {
      label: "General",
      items: [
        { href: "/", label: "Projects", icon: FolderKanban },
        { href: "/remote-server", label: "Servers", icon: Server },
        ...(cloudEdition ? [{ href: "/subscription", label: "Subscription", icon: CreditCard }] : []),
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
      label: "Domains",
      items: [
        { href: "/traefik", label: "Domains", icon: Globe },
        {
          href: "https://docs.weehawk.io",
          label: "Documentation",
          icon: BookOpen,
          external: true,
        },
        {
          href: "https://docs.weehawk.io/support",
          label: "Support",
          icon: LifeBuoy,
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
}: {
  collapsed: boolean;
  href: string;
  label: string;
  active: boolean;
  icon: LucideIcon;
  activeLayoutId: string;
  external?: boolean;
}) {
  const className = cn(
    "relative flex items-center rounded-xl transition-colors duration-200 group",
    collapsed ? "justify-center px-2 py-2" : "gap-3 px-4 py-2",
    active ? "text-primary" : "text-foreground/90 hover:text-foreground hover:bg-accent/70",
  );

  const inner = (
    <>
      {active && !external && (
        <motion.div
          layoutId={activeLayoutId}
          className="absolute inset-0 bg-primary/10 rounded-xl border border-primary/20"
          initial={false}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
        />
      )}
      <Icon
        className={cn(
          "w-4 h-4 relative z-10 flex-shrink-0",
          active ? "text-primary" : "text-foreground/90 group-hover:text-foreground",
        )}
      />
      {!collapsed && <span className="font-medium relative z-10 text-sm">{label}</span>}
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
          {external ? <span className="block text-[10px] text-muted-foreground mt-0.5">Opens in new tab</span> : null}
        </TooltipContent>
      </Tooltip>
    );
  }

  return link;
}

export function Sidebar() {
  const { collapsed, toggle } = useSidebarLayout();
  const location = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const setupQuery = useQuery({
    queryKey: ["auth", "setup-status"],
    queryFn: fetchSetupStatus,
    staleTime: 0,
    gcTime: 0,
  });
  const editionTag = setupQuery.data?.edition ?? editionFromEnv();
  const layoutGroupId = "sidebar-nav-main";
  const activeLayoutId = "active-nav-main";

  const displayName = user
    ? `${user.firstName} ${user.lastName}`.trim() || user.email
    : "User";
  const initials =
    user && (user.firstName || user.lastName)
      ? `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase()
      : user?.email?.[0]?.toUpperCase() ?? "U";

  const cloudUi = isCloudEdition();
  const mainNavSections = useMemo(() => buildMainNavSections(cloudUi), [cloudUi]);
  const consoleMatch = /^\/console\/([^/]+)/.exec(location);
  const onSecretsShell = location === "/secrets" || location.startsWith("/secrets/");
  const consoleNavBase =
    consoleMatch != null
      ? `/console/${consoleMatch[1]}`
      : onSecretsShell && !cloudUi
        ? "/console/local"
        : null;
  const dockerNavDynamic =
    consoleNavBase != null ? buildDockerNavItems(consoleNavBase) : [];

  const dockerShell =
    /^\/console\/[^/]+/.test(location) ||
    location === "/secrets" ||
    location.startsWith("/secrets/");

  /** Under `/console/:id/...` show only Docker nav for that server (not General / Integrations / …). */
  const isConsoleServerSidebar = /^\/console\/[^/]+/.test(location);
  const consoleLogoHref =
    consoleNavBase != null ? `${consoleNavBase}/images` : "/";

  const isActive = (href: string) => {
    if (href === "/") return location === "/";
    if (href === "/notifications/channels") return location.startsWith("/notifications");
    if (href === "/registry") {
      return location === "/registry" || location.startsWith("/registry/saved");
    }
    if (href === "/git") {
      return location === "/git" || location.startsWith("/git/");
    }
    if (href === "/traefik") {
      return location === "/traefik" || location.startsWith("/traefik/");
    }
    if (href === "/remote-server") {
      return (
        location === "/remote-server" ||
        location.startsWith("/remote-server/") ||
        (!cloudUi && location.startsWith("/console/local"))
      );
    }
    if (href === "/subscription") {
      return location === "/subscription" || location.startsWith("/subscription/");
    }
    if (href.includes("/secrets")) {
      if (location === href || location.startsWith(`${href}/`)) return true;
      if (
        href === "/console/local/secrets" &&
        (location === "/secrets" || location.startsWith("/secrets/"))
      )
        return true;
      return false;
    }
    return location.startsWith(href);
  };

  return (
    <aside
      className={cn(
        "border-r border-border bg-card/30 backdrop-blur-xl fixed top-0 left-0 h-screen flex flex-col z-40",
        "w-[var(--app-sidebar-width)] transition-[width] duration-200 ease-out overflow-x-hidden",
      )}
    >
      {/* Logo + collapse toggle */}
      <div className={cn("flex-shrink-0 pt-7 pb-1.5", collapsed ? "px-2" : "px-6")}>
        {!collapsed ? (
          <div className="flex items-start gap-2">
            <Link
              href={isConsoleServerSidebar ? consoleLogoHref : "/"}
              scroll={false}
              className="flex items-start gap-3 flex-1 min-w-0 rounded-xl -mx-1 px-1 py-0.5 hover:bg-accent/60 transition-colors"
            >
              <div className="relative w-10 h-10 rounded-xl overflow-hidden border border-primary/20 shadow-sm flex-shrink-0 ring-1 ring-border/70 dark:shadow-[0_0_15px_rgba(255,255,255,0.08)] dark:ring-white/5">
                <Image
                  src="/weehawk-logo.png"
                  alt="Weehawk"
                  width={40}
                  height={40}
                  className="logo-adaptive object-cover size-10"
                  priority
                />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <h1 className="font-bold text-lg text-foreground tracking-tight leading-none">Weehawk</h1>
                <p className="text-[10px] text-muted-foreground tracking-widest uppercase font-mono mt-1">
                  {editionTag}
                </p>
              </div>
            </Link>
            <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
              <ThemeToggle />
              <button
                type="button"
                onClick={toggle}
                aria-label="Collapse sidebar"
                className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/80 shrink-0"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
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
                  src="/weehawk-logo.png"
                  alt="Weehawk"
                  width={40}
                  height={40}
                  className="logo-adaptive object-cover size-10"
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
      <nav className={cn("flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-3", collapsed ? "px-2" : "px-4")}>
        <LayoutGroup id={layoutGroupId}>
          {isConsoleServerSidebar ? (
            <>
              <div className={cn("mb-1.5", collapsed && "mt-4")}>
                {!collapsed && (
                  <p className="text-[10px] text-muted-foreground/80 tracking-widest uppercase font-mono px-4 mb-0.5 mt-4">
                    General
                  </p>
                )}
                <div className="space-y-px">
                  <NavRow
                    collapsed={collapsed}
                    href="/remote-server"
                    label="Servers"
                    active={isActive("/remote-server")}
                    icon={Server}
                    activeLayoutId={activeLayoutId}
                  />
                </div>
              </div>
              <div className="mb-1.5">
                {!collapsed && (
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
                        collapsed={collapsed}
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
                    collapsed && sectionIndex > 0 && "mt-1.5",
                    collapsed && sectionIndex === 0 && "mt-4",
                  )}
                >
                  {!collapsed && (
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
                          collapsed={collapsed}
                          href={item.href}
                          label={item.label}
                          active={active}
                          icon={item.icon}
                          activeLayoutId={activeLayoutId}
                          external={item.external}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}

              {dockerNavDynamic.length > 0 ? (
                <div className="mb-1.5">
                  {!collapsed && (
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
                          collapsed={collapsed}
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
                  {collapsed ? (
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

      {/* Profile */}
      <div className="flex-shrink-0 border-t border-border p-2.5 relative">
        <AnimatePresence>
          {profileOpen && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.15 }}
              className={cn(
                "mb-2 p-2 rounded-xl bg-card/80 border border-border",
                collapsed &&
                  "absolute left-full bottom-2 ml-2 w-52 z-[60] shadow-xl bg-popover border-border backdrop-blur-xl",
              )}
            >
              <Link
                href="/profile"
                scroll={false}
                onClick={() => setProfileOpen(false)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  location === "/profile"
                    ? "text-primary bg-accent"
                    : "text-foreground/90 hover:text-foreground hover:bg-accent/70"
                }`}
              >
                <UserCircle className="w-4 h-4" />
                Profile
              </Link>
              <div className="h-px bg-border my-1" />
              <button
                type="button"
                onClick={async () => {
                  setProfileOpen(false);
                  await logout();
                  router.replace("/");
                }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-red-400/80 hover:text-red-400 hover:bg-red-500/5 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign out
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {collapsed ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setProfileOpen((v) => !v)}
                aria-expanded={profileOpen}
                aria-haspopup="menu"
                className="w-full flex justify-center items-center px-2 py-2 rounded-xl hover:bg-accent/70 transition-colors group"
              >
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/20 to-muted/40 border border-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-primary tracking-tight">{initials}</span>
                </div>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              <span className="font-medium">{displayName}</span>
              {user?.email ? <span className="block text-xs opacity-80 mt-0.5">{user.email}</span> : null}
            </TooltipContent>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={() => setProfileOpen((v) => !v)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-accent/70 transition-colors group"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/20 to-muted/40 border border-primary/20 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-primary tracking-tight">{initials}</span>
            </div>
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-semibold text-foreground leading-none truncate">{displayName}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{user?.email ?? ""}</p>
            </div>
            <motion.div
              animate={{ rotate: profileOpen ? 0 : 180 }}
              transition={{ duration: 0.2 }}
              className="text-muted-foreground group-hover:text-foreground transition-colors"
            >
              <ChevronUp className="w-4 h-4" />
            </motion.div>
          </button>
        )}
      </div>
    </aside>
  );
}
