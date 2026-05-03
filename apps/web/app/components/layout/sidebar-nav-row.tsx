"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function NavRow({
  collapsed,
  href,
  label,
  active,
  icon: Icon,
  activeLayoutId,
  external,
  onNavigate,
  disabled,
  disabledHint = "No access",
}: {
  collapsed: boolean;
  href: string;
  label: string;
  active: boolean;
  icon: LucideIcon;
  activeLayoutId: string;
  external?: boolean;
  onNavigate?: () => void;
  /** When true, the row is non-interactive and visually muted. */
  disabled?: boolean;
  /** Shown in the collapsed tooltip under the label. */
  disabledHint?: string;
}) {
  const className = cn(
    "relative flex items-center rounded-xl transition-colors duration-200 group",
    collapsed ? "justify-center px-2 py-2" : "gap-3 px-4 py-2",
    disabled
      ? "cursor-not-allowed text-muted-foreground/55"
      : active
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
            disabled
              ? "border-border/40 bg-muted/30"
              : cn(
                  "bg-violet-500/[0.12] border-violet-500/30",
                  "dark:bg-primary/10 dark:border-primary/20",
                ),
          )}
          initial={false}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
        />
      )}
      <span className="relative z-10 inline-flex flex-shrink-0">
        <Icon
          className={cn(
            "h-4 w-4",
            disabled
              ? active
                ? "text-muted-foreground/65"
                : "text-muted-foreground/45"
              : active
                ? "text-violet-700 dark:text-primary"
                : "text-foreground/90 group-hover:text-foreground",
          )}
        />
      </span>
      {!collapsed && (
        <span className="relative z-10 min-w-0 break-words text-sm font-medium leading-snug">{label}</span>
      )}
    </>
  );

  const link = disabled ? (
    <span className={className} aria-disabled="true" aria-label={`${label} (${disabledHint})`}>
      {inner}
    </span>
  ) : external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {inner}
    </a>
  ) : (
    <Link href={href} scroll={false} className={className} onClick={() => onNavigate?.()}>
      {inner}
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {label}
          {disabled ? (
            <span className="mt-0.5 block text-[10px] text-muted-foreground">{disabledHint}</span>
          ) : null}
          {external ? <span className="mt-0.5 block text-[10px] text-muted-foreground">Opens in new tab</span> : null}
        </TooltipContent>
      </Tooltip>
    );
  }

  return link;
}
