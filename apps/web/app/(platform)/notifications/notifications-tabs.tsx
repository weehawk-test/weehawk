"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Plus } from "lucide-react";

const TABS = [
  { href: "/notifications/channels", label: "Channels" },
  { href: "/notifications/history", label: "History" },
] as const;

export function NotificationsTabs() {
  const pathname = usePathname();
  const subtitle =
    pathname === "/notifications/history"
      ? "History of sent notifications."
      : "Manage notification channels.";

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-10">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Notifications</h1>
          <p className="text-muted-foreground">{subtitle}</p>
        </div>
        {pathname === "/notifications/channels" ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("notifications:add-channel"))}
              className="btn-primary flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Add Channel
            </button>
          </div>
        ) : null}
      </div>
      <div className="flex gap-1 p-1 w-fit mb-6 rounded-xl border border-border bg-muted/70 shadow-sm dark:border-white/5 dark:bg-card/50 dark:shadow-none">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`relative flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {active && (
                <motion.div
                  layoutId="notif-tab-route"
                  className="absolute inset-0 rounded-lg border border-zinc-200 bg-background shadow-sm dark:border-white/10 dark:bg-white/10 dark:shadow-none"
                  initial={false}
                  transition={{ type: "spring", stiffness: 400, damping: 35 }}
                />
              )}
              <span className="relative z-10">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
