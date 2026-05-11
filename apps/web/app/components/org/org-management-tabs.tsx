"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrgManagementTabMatch } from "@/lib/org-workspace-permissions";

const tabs = [
  { href: "/members", label: "Members", icon: Users, match: "members" as const },
  { href: "/audit", label: "Audit log", icon: ClipboardList, match: "audit" as const },
] as const;

export function OrgManagementTabs({
  base,
  memberCount,
  allowedTabMatches,
}: {
  base: string;
  /** Member count badge on the Members tab (from server layout). */
  memberCount: number;
  /** Tabs the current user may open (from workspace permissions). */
  allowedTabMatches: Set<OrgManagementTabMatch>;
}) {
  const pathname = usePathname();
  const normalizedBase = base.replace(/\/$/, "");

  const activeMatch = (): OrgManagementTabMatch => {
    if (pathname.startsWith(`${normalizedBase}/audit`)) return "audit";
    return "members";
  };

  const current = activeMatch();

  return (
    <nav
      className="-mb-px flex min-w-0 gap-1 overflow-x-auto pb-px sm:gap-2"
      aria-label="Organization sections"
    >
      {tabs.map(({ href, label, icon: Icon, match }) => {
        const fullHref = `${normalizedBase}${href}`;
        const allowed = allowedTabMatches.has(match);
        const isActive = current === match;
        const showMemberBadge = match === "members";

        const tabClass = cn(
          "group flex shrink-0 items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium transition-colors sm:px-2",
          !allowed && "cursor-not-allowed text-muted-foreground/60 opacity-50 saturate-50",
          allowed &&
            (isActive
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"),
          !allowed && isActive && "border-muted-foreground/35 text-muted-foreground",
        );

        const inner = (
          <>
            <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
            <span>{label}</span>
            {showMemberBadge ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                  !allowed && "bg-muted/80 text-muted-foreground/80",
                  allowed &&
                    (isActive
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground group-hover:text-foreground"),
                )}
              >
                {memberCount}
              </span>
            ) : null}
          </>
        );

        if (!allowed) {
          return (
            <span
              key={match}
              className={tabClass}
              aria-disabled="true"
              aria-label={`${label} (No access)`}
              title="No access"
            >
              {inner}
            </span>
          );
        }

        return (
          <Link key={match} href={fullHref} scroll={false} className={tabClass}>
            {inner}
          </Link>
        );
      })}
    </nav>
  );
}
