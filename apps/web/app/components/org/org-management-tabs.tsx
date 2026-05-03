"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Home, Settings, Shield, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/overview", label: "Overview", icon: Home, match: "overview" },
  { href: "/audit", label: "Audit log", icon: ClipboardList, match: "audit" },
  { href: "/members", label: "Members", icon: Users, match: "members" },
  { href: "/permissions", label: "Permission", icon: Shield, match: "permissions" },
  { href: "/settings", label: "Settings", icon: Settings, match: "settings" },
] as const;

export function OrgManagementTabs({
  base,
  memberCount,
}: {
  base: string;
  /** Member count badge on the Members tab (from server layout). */
  memberCount: number;
}) {
  const pathname = usePathname();
  const normalizedBase = base.replace(/\/$/, "");

  const activeMatch = (): (typeof tabs)[number]["match"] => {
    if (
      pathname === `${normalizedBase}/overview` ||
      pathname.startsWith(`${normalizedBase}/overview/`)
    ) {
      return "overview";
    }
    if (pathname.startsWith(`${normalizedBase}/audit`)) return "audit";
    if (pathname.startsWith(`${normalizedBase}/members`)) return "members";
    if (pathname.startsWith(`${normalizedBase}/permissions`)) return "permissions";
    if (pathname.startsWith(`${normalizedBase}/settings`)) return "settings";
    return "overview";
  };

  const current = activeMatch();

  return (
    <nav
      className="-mb-px flex min-w-0 gap-1 overflow-x-auto pb-px sm:gap-2"
      aria-label="Organization sections"
    >
      {tabs.map(({ href, label, icon: Icon, match }) => {
        const fullHref = `${normalizedBase}${href}`;
        const isActive = current === match;
        const showMemberBadge = match === "members";

        return (
          <Link
            key={match}
            href={fullHref}
            scroll={false}
            className={cn(
              "group flex shrink-0 items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium transition-colors sm:px-2",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
            <span>{label}</span>
            {showMemberBadge ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground group-hover:text-foreground",
                )}
              >
                {memberCount}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
