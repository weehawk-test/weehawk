"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  PanelLeft,
  PanelRight,
  LogOut,
  Menu,
  Server,
  UserCog,
} from "lucide-react";
import { LayoutGroup } from "framer-motion";
import type { OrganizationPublic } from "@/lib/organizations-types";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSidebarLayout } from "@/contexts/sidebar-layout-context";
import { NavRow } from "./sidebar-nav-row";
import {
  buildMainNavSections,
  buildDockerNavItems,
  isOrgMainNavItemDisabled,
} from "./main-nav-sections";
import {
  ORG_WORKSPACE_PERMISSIONS,
} from "@/lib/org-workspace-permissions";
import {
  orgFullHrefIsActive,
  orgPersonalNavIsActive,
  prefixOrgHref,
} from "@/lib/org-nav-utils";
import { useAuth } from "@/contexts/auth-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProfileThemeMenuItems } from "./profile-theme-menu-items";
import { WorkspaceSwitcher } from "./workspace-switcher";

const ORG_LAYOUT = "org-sidebar-nav";
const ORG_ACTIVE = "org-sidebar-active-pill";

type OrganizationSidebarProps = {
  org: OrganizationPublic;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
};

export function OrganizationSidebar({ org, mobileOpen, onMobileOpenChange }: OrganizationSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  /** Legacy `prefixOrgHref` second arg; URLs are flat (active org is cookie-scoped). */
  const navOrgBase = "";
  const { collapsed, toggle, isMobileNav } = useSidebarLayout();
  const { user, logout } = useAuth();
  const railMode = collapsed && !isMobileNav;

  const mainNavSections = useMemo(() => buildMainNavSections(), []);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  const nameParts = [user?.firstName?.trim(), user?.lastName?.trim()].filter(Boolean);
  const displayName = nameParts.length > 0 ? nameParts.join(" ") : user?.email ?? "Weehawk User";
  const displayEmail = user?.email ?? "No email";
  const avatarUrl = user?.imageUrl?.trim() ? user.imageUrl : null;
  const initials =
    displayName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "WU";

  useEffect(() => {
    onMobileOpenChange(false);
  }, [pathname, onMobileOpenChange]);

  const orgDockerConsoleMatch = /^\/docker-manager\/([^/]+)/u.exec(pathname);
  const consoleNavBase =
    orgDockerConsoleMatch != null ? `/docker-manager/${orgDockerConsoleMatch[1]}` : null;
  const dockerNavDynamic = consoleNavBase != null ? buildDockerNavItems(consoleNavBase) : [];

  const dockerShell =
    /^\/docker-manager\/[^/]+/u.test(pathname) ||
    pathname === "/secrets" ||
    pathname.startsWith("/secrets/");

  const isConsoleOrgSidebar = /^\/docker-manager\/[^/]+/u.test(pathname);
  const consoleLogoHref = consoleNavBase != null ? `${consoleNavBase}/images` : "/home";

  const closeMobile = () => onMobileOpenChange(false);

  const handleEditProfile = () => {
    setProfileMenuOpen(false);
    closeMobile();
    router.push("/profile");
  };

  const handleLogout = async () => {
    setProfileMenuOpen(false);
    closeMobile();
    await logout();
    router.replace("/login");
  };

  const asideClass = cn(
    "flex min-h-0 min-w-0 flex-col overflow-x-hidden border-border",
    isMobileNav
      ? cn(
          "bg-card h-[100dvh] max-h-[100dvh] border-r-0 pt-[env(safe-area-inset-top,0px)] transition-transform duration-200 ease-out",
          mobileOpen ? "shadow-2xl" : "shadow-none",
        )
      : "h-screen bg-card/30 backdrop-blur-xl border-r transition-[width] duration-200 ease-out",
    "w-[min(20rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] md:w-[var(--app-sidebar-width)] md:max-w-none",
    "fixed left-0 top-0 z-40",
    "md:translate-x-0 md:pointer-events-auto",
    mobileOpen ? "translate-x-0 pointer-events-auto" : "max-md:-translate-x-[calc(100%+2px)] max-md:pointer-events-none",
  );

  return (
    <>
      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 border-0 bg-black/45 p-0 backdrop-blur-[2px] md:hidden"
          aria-label="Close organization menu"
          onClick={() => onMobileOpenChange(false)}
        />
      ) : null}

      <aside id="org-workspace-sidebar" className={asideClass} aria-label="Organization sidebar">
        <div className={cn("relative flex-shrink-0 pt-7 pb-1.5", railMode ? "px-2" : "px-6 max-md:px-4")}>
          {!railMode ? (
            <div className="flex min-w-0 items-start gap-2">
              <Link
                href={isConsoleOrgSidebar ? consoleLogoHref : "/home"}
                scroll={false}
                onClick={closeMobile}
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
              <WorkspaceSwitcher
                className="min-w-0 flex-1"
                currentLabel={org.name}
                activeOrgPublicId={org.publicId}
                onNavigate={closeMobile}
              />
              <div className="flex shrink-0 items-center gap-0.5">
                {isMobileNav ? (
                  <button
                    type="button"
                    onClick={closeMobile}
                    aria-label="Close menu"
                    className="shrink-0 rounded-lg p-1.5 text-foreground hover:bg-accent/80"
                  >
                    <PanelLeft className="size-4 -translate-y-px" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={toggle}
                    aria-label="Collapse sidebar"
                    className="rounded-lg p-1.5 text-foreground hover:bg-accent/80"
                  >
                    <PanelLeft className="size-4 -translate-y-px" />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2.5">
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Link
                    href={isConsoleOrgSidebar ? consoleLogoHref : "/home"}
                    scroll={false}
                    className="flex justify-center rounded-xl p-1 transition-colors hover:bg-accent/60"
                    onClick={closeMobile}
                  >
                    <div className="relative size-10 overflow-hidden rounded-xl border border-primary/20 shadow-sm ring-1 ring-border/70 dark:shadow-[0_0_15px_rgba(255,255,255,0.08)] dark:ring-white/5">
                      <Image
                        src="/weehawk-logo.svg"
                        alt="Weehawk"
                        width={40}
                        height={40}
                        className="logo-adaptive size-10 scale-90 object-contain p-0.5"
                        priority
                      />
                    </div>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {org.name}
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
                    <PanelRight className="size-4 -translate-y-px" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  Expand sidebar
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>

        <nav
          className={cn(
            "min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain pb-3",
            railMode ? "px-2" : "px-4 max-md:px-3",
          )}
          aria-label="Organization navigation"
        >
          <LayoutGroup id={ORG_LAYOUT}>
            {isConsoleOrgSidebar ? (
              <>
                <div className={cn("mb-1.5", railMode && "mt-4")}>
                  {!railMode && (
                    <p className="mb-0.5 mt-4 px-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/80">
                      General
                    </p>
                  )}
                  <div className="space-y-px">
                    <NavRow
                      collapsed={railMode}
                      href={prefixOrgHref(navOrgBase, "/remote-server")}
                      label="Servers"
                      active={orgPersonalNavIsActive(pathname, navOrgBase, "/remote-server")}
                      icon={Server}
                      activeLayoutId={ORG_ACTIVE}
                      onNavigate={closeMobile}
                      disabled={
                        !org.isOwner && !org.workspacePermissions[ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER]
                      }
                    />
                  </div>
                </div>
                <div className="mb-1.5">
                  {!railMode && (
                    <p className="mb-0.5 mt-3 px-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/80">
                      Docker
                    </p>
                  )}
                  <div className="space-y-px">
                    {dockerNavDynamic.map((item) => (
                      <NavRow
                        key={item.href}
                        collapsed={railMode}
                        href={item.href}
                        label={item.label}
                        active={orgFullHrefIsActive(pathname, item.href)}
                        icon={item.icon}
                        activeLayoutId={ORG_ACTIVE}
                        onNavigate={closeMobile}
                      />
                    ))}
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
                        className={cn(
                          "mb-0.5 px-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/80",
                          sectionIndex === 0 ? "mt-4" : "mt-3",
                        )}
                      >
                        {section.label}
                      </p>
                    )}
                    <div className="space-y-px">
                      {section.items.map((item) => {
                        const href = prefixOrgHref(navOrgBase, item.href);
                        const active = item.external
                          ? false
                          : orgPersonalNavIsActive(pathname, navOrgBase, item.href);
                        const navDisabled = isOrgMainNavItemDisabled(org, item);
                        return (
                          <NavRow
                            key={item.href}
                            collapsed={railMode}
                            href={href}
                            label={item.label}
                            active={active}
                            icon={item.icon}
                            activeLayoutId={ORG_ACTIVE}
                            external={item.external}
                            onNavigate={closeMobile}
                            disabled={navDisabled}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}

                {dockerNavDynamic.length > 0 ? (
                  <div className="mb-1.5">
                    {!railMode && (
                      <p className="mb-0.5 mt-3 px-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/80">
                        Docker
                      </p>
                    )}
                    <div className="space-y-px">
                      {dockerNavDynamic.map((item) => (
                        <NavRow
                          key={item.href}
                          collapsed={railMode}
                          href={item.href}
                          label={item.label}
                          active={orgFullHrefIsActive(pathname, item.href)}
                          icon={item.icon}
                          activeLayoutId={ORG_ACTIVE}
                          onNavigate={closeMobile}
                        />
                      ))}
                    </div>
                  </div>
                ) : dockerShell && consoleNavBase == null ? (
                  <div className="mb-1.5">
                    {railMode ? (
                      <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                          <Link
                            href={prefixOrgHref(navOrgBase, "/remote-server")}
                            className="flex justify-center rounded-xl p-2.5 text-primary hover:bg-accent/70"
                            aria-label="Add a remote server"
                            onClick={closeMobile}
                          >
                            <Server className="size-5" />
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent side="right" sideOffset={8} className="max-w-[220px]">
                          Add an SSH host under Remote servers to open the Docker console for that machine.
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <p className="px-4 py-1.5 text-xs leading-relaxed text-foreground/90">
                        Add an SSH host under{" "}
                        <Link
                          href={prefixOrgHref(navOrgBase, "/remote-server")}
                          className="text-primary hover:underline"
                          onClick={closeMobile}
                        >
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
                      <span className="text-xs font-bold tracking-tight text-primary">{initials}</span>
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
                      <span className="text-xs font-bold tracking-tight text-primary">{initials}</span>
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
                <p className="truncate text-base font-semibold leading-tight">{displayName}</p>
                <p className="mt-1 truncate text-sm text-muted-foreground">{displayEmail}</p>
              </div>
              <DropdownMenuItem onSelect={handleEditProfile}>
                <UserCog className="h-4 w-4" />
                Edit profile
              </DropdownMenuItem>
              <ProfileThemeMenuItems />
              <DropdownMenuItem
                onSelect={() => void handleLogout()}
                className="text-red-600 dark:text-red-400 focus:bg-red-500/10 focus:text-red-700 dark:focus:text-red-300"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}

export function OrganizationMobileHeader({
  org,
  menuOpen = false,
  onOpenMenu,
}: {
  org: OrganizationPublic;
  /** When the org drawer is open on mobile, the top bar is hidden so only the drawer + scrim show. */
  menuOpen?: boolean;
  onOpenMenu: () => void;
}) {
  return (
    <header
      className={cn(
        "sticky top-0 z-[40] flex w-full min-w-0 items-center gap-2 border-b border-border/70 bg-background/90 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top,0px))] backdrop-blur-md supports-[backdrop-filter]:bg-background/75 md:hidden",
        menuOpen && "max-md:hidden",
      )}
    >
      <button
        type="button"
        onClick={onOpenMenu}
        className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-card/50 text-foreground transition-colors hover:bg-accent/70"
        aria-expanded={menuOpen}
        aria-controls="org-workspace-sidebar"
        aria-label="Open organization menu"
      >
        <Menu className="size-5" />
      </button>
      <Link
        href="/home"
        scroll={false}
        className="relative size-9 shrink-0 overflow-hidden rounded-lg border border-primary/20 bg-card/40 shadow-sm ring-1 ring-border/70 outline-none ring-offset-background transition-colors hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:ring-white/5"
        aria-label="Weehawk home"
      >
        <Image
          src="/weehawk-logo.svg"
          alt=""
          width={36}
          height={36}
          className="logo-adaptive size-9 scale-90 object-contain p-0.5"
        />
      </Link>
      <div className="min-w-0 flex-1 py-0.5">
        <p className="truncate text-base font-bold leading-tight tracking-tight text-foreground">Weehawk</p>
        <p className="mt-0.5 truncate text-xs font-medium leading-snug text-muted-foreground">
          {org.name}
        </p>
      </div>
    </header>
  );
}
