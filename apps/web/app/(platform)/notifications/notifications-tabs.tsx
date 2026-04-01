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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Notifications</h1>
          <p className="text-muted-foreground text-sm mt-1">{subtitle}</p>
        </div>
        {pathname === "/notifications/channels" ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("notifications:add-channel"))}
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Channel
            </button>
          </div>
        ) : null}
      </div>
      <div className="flex gap-1 p-1 bg-card/50 rounded-xl border border-white/5 w-fit mb-6">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {active && (
                <motion.div
                  layoutId="notif-tab-route"
                  className="absolute inset-0 bg-white/10 rounded-lg border border-white/10"
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
