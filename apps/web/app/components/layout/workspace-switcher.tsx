"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useAuth, type AuthUser } from "@/contexts/auth-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  fetchOrganizations,
  ORGANIZATIONS_LIST_CHANGED_EVENT,
} from "@/lib/organizations-api";
import type { OrganizationPublic } from "@/lib/organizations-types";
import {
  setActiveOrganizationPublicBrowserCookie,
  WEHAWK_ACTIVE_ORG_COOKIE,
} from "@/lib/active-org-cookie";
import { cn } from "@/lib/utils";

/** Always land on the workspace start page after switching organization. */
function targetPathAfterOrgSwitch(): string {
  return "/projects";
}

type WorkspaceSwitcherProps = {
  /** Current organization name (shown under “Weehawk” when that org is active). */
  currentLabel?: string;
  /** Active organization public id, or null on global pages (e.g. profile, docker console). */
  activeOrgPublicId?: string | null;
  onNavigate?: () => void;
  className?: string;
};

/** Same initials logic as sidebar profile avatar */
function userDisplayAndInitials(user: AuthUser) {
  const nameParts = [user.firstName?.trim(), user.lastName?.trim()].filter(Boolean);
  const displayName = nameParts.length > 0 ? nameParts.join(" ") : user.email ?? "Weehawk User";
  const initials =
    displayName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "WU";
  return { displayName, initials };
}

function initialsFromOrgName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/** Matches `Sidebar` / `OrganizationSidebar` profile avatar shell */
function WorkspaceRowAvatar({
  imageUrl,
  initials,
  alt,
}: {
  imageUrl?: string | null;
  initials: string;
  alt: string;
}) {
  const src = imageUrl?.trim() || null;
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-gradient-to-br from-primary/20 to-muted/40">
      {src ? (
        // User avatars are external URLs (e.g. Google); same pattern as sidebar profile.
        // eslint-disable-next-line @next/next/no-img-element -- remote profile URLs, not in `next/image` domains
        <img src={src} alt={alt} className="h-full w-full rounded-xl object-cover" referrerPolicy="no-referrer" />
      ) : (
        <span className="text-xs font-bold tracking-tight text-primary">{initials}</span>
      )}
    </div>
  );
}

const menuItemClass =
  "cursor-pointer rounded-lg px-2 py-0 mx-1.5 my-0 focus:bg-accent/80 data-[highlighted]:bg-accent/80";

const rowLinkClass =
  "flex w-full min-w-0 items-center gap-2 py-1.5 pl-2 pr-1.5 text-left no-underline outline-none";

function readCookieValue(name: string): string {
  if (typeof document === "undefined") return "";
  const parts = document.cookie.split("; ");
  for (const part of parts) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    if (part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return "";
}

export function WorkspaceSwitcher({
  currentLabel = "",
  activeOrgPublicId,
  onNavigate,
  className,
}: WorkspaceSwitcherProps) {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [orgs, setOrgs] = useState<OrganizationPublic[]>([]);
  const [pendingOrgPublicId, setPendingOrgPublicId] = useState("");
  const cookieActiveOrgPublicId = readCookieValue(WEHAWK_ACTIVE_ORG_COOKIE).trim();
  const effectiveActiveOrgPublicId =
    pendingOrgPublicId ||
    (activeOrgPublicId != null && activeOrgPublicId.trim() !== ""
      ? activeOrgPublicId.trim()
      : cookieActiveOrgPublicId);

  const selectOrganization = (publicId: string) => {
    setPendingOrgPublicId(publicId.trim());
    setActiveOrganizationPublicBrowserCookie(publicId);
    /** Drop cached lists/details so UI cannot show the previous org’s data while RSC refreshes. */
    queryClient.clear();
    onNavigate?.();
    const next = targetPathAfterOrgSwitch();
    const runNav = () => {
      if (next !== pathname) {
        router.push(next);
      } else {
        router.refresh();
      }
    };
    /** Next tick: cookie is committed before refresh/navigation requests. */
    queueMicrotask(runNav);
  };

  const accountHint = useMemo(() => {
    if (!user) return "Account";
    if (pathname === "/profile" || pathname.startsWith("/profile/")) return "Account";
    const { displayName } = userDisplayAndInitials(user);
    return displayName;
  }, [user, pathname]);

  const activeOrgLabel = useMemo(() => {
    if (!effectiveActiveOrgPublicId) return "";
    const fromList = orgs.find((o) => o.publicId === effectiveActiveOrgPublicId)?.name?.trim() ?? "";
    if (fromList) return fromList;
    return currentLabel.trim();
  }, [effectiveActiveOrgPublicId, orgs, currentLabel]);

  useEffect(() => {
    if (!pendingOrgPublicId) return;
    const propOrg = activeOrgPublicId?.trim() ?? "";
    const cookieOrg = readCookieValue(WEHAWK_ACTIVE_ORG_COOKIE).trim();
    if (pendingOrgPublicId === propOrg || pendingOrgPublicId === cookieOrg) {
      setPendingOrgPublicId("");
    }
  }, [pendingOrgPublicId, activeOrgPublicId, pathname]);

  useEffect(() => {
    if (!user?.userId) {
      queueMicrotask(() => setOrgs([]));
      return;
    }
    let cancelled = false;
    const load = () => {
      void fetchOrganizations()
        .then((list) => {
          if (!cancelled) setOrgs(list);
        })
        .catch(() => {
          if (!cancelled) setOrgs([]);
        });
    };
    load();
    const onListChanged = () => load();
    window.addEventListener(ORGANIZATIONS_LIST_CHANGED_EVENT, onListChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(ORGANIZATIONS_LIST_CHANGED_EVENT, onListChanged);
    };
  }, [user?.userId]);

  const triggerLabel = activeOrgLabel || accountHint;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex min-h-0 min-w-0 w-full max-w-full flex-col items-stretch rounded-xl px-1 py-0.5 text-left -mx-1",
            "outline-none transition-colors hover:bg-accent/60 data-[state=open]:bg-accent/60",
            /** Avoid `focus-visible:bg-*`: Radix returns focus to the trigger on close, which looked stuck “hovered”. */
            "focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:ring-offset-0",
            className,
          )}
          aria-label="Workspace and organizations"
          aria-haspopup="menu"
        >
          <span className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-left text-lg font-bold tracking-tight leading-none text-foreground">
              Weehawk
            </span>
            <ChevronsUpDown
              className="size-3.5 shrink-0 translate-y-0.5 text-foreground"
              aria-hidden
            />
          </span>
          <span
            className="mt-1 block min-w-0 truncate text-left font-mono text-[10px] tracking-widest text-muted-foreground"
            title={triggerLabel}
          >
            {triggerLabel}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className={cn(
          "min-w-[15.5rem] max-w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border/80 bg-popover p-0 py-2 shadow-xl",
          "dark:border-border/60 dark:bg-zinc-950/98 dark:shadow-black/40",
        )}
      >
        <DropdownMenuLabel className="px-3 pb-1.5 pt-0 text-[11px] font-normal uppercase tracking-wider text-muted-foreground">
          Organizations
        </DropdownMenuLabel>

        <div className="px-0">
          {orgs.map((o) => {
            const active = o.publicId === effectiveActiveOrgPublicId;
            const orgInitials = initialsFromOrgName(o.name);
            return (
              <DropdownMenuItem
                key={o.publicId}
                className={menuItemClass}
                onSelect={() => {
                  selectOrganization(o.publicId);
                }}
              >
                <div className={rowLinkClass}>
                  <WorkspaceRowAvatar imageUrl={null} initials={orgInitials} alt={o.name} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{o.name}</span>
                  {active ? (
                    <Check
                      className="size-4 shrink-0 -translate-x-0.5 text-foreground"
                      strokeWidth={2.25}
                      aria-hidden
                    />
                  ) : null}
                </div>
              </DropdownMenuItem>
            );
          })}
        </div>

        <DropdownMenuSeparator className="my-1.5 bg-border/70 dark:bg-border/50" />

        <DropdownMenuItem asChild className={cn(menuItemClass, "mt-0")}>
          <Link
            href="/organizations/create"
            scroll={false}
            onClick={onNavigate}
            className={cn(rowLinkClass, "text-muted-foreground hover:text-foreground")}
          >
            <Plus className="size-4 shrink-0 opacity-80" strokeWidth={2} aria-hidden />
            <span className="text-sm font-medium">Create organization</span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
