"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  Webhook, LayoutDashboard, FolderKanban, KeyRound, UserCircle, ChevronUp,
  ImageIcon, Box, Database, Bell, HardDrive, Network, Boxes, ShieldCheck, Clock3,
  GitBranch, ArrowRight, ArrowLeft, RadioTower,
} from "lucide-react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { fetchSetupStatus } from "@/lib/auth-api";
import type { LucideIcon } from "lucide-react";

const dockerNavItems: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/docker/images", label: "Images", icon: ImageIcon },
  { href: "/docker/containers", label: "Containers", icon: Box },
  { href: "/docker/services", label: "Services", icon: Boxes },
  { href: "/docker/networks", label: "Networks", icon: Network },
  { href: "/secrets", label: "Secrets", icon: KeyRound },
  { href: "/docker/volumes", label: "Volumes", icon: Database },
];

const mainNavSections: { label: string; items: { href: string; label: string; icon: LucideIcon }[] }[] = [
  {
    label: "General",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard },
      { href: "/projects", label: "Projects", icon: FolderKanban },
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
    items: [{ href: "/traefik", label: "Traefik", icon: RadioTower }],
  },
];

export function Sidebar({ variant = "main" }: { variant?: "main" | "docker" }) {
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
  const editionTag = setupQuery.data?.edition ?? "selfhosted";
  const layoutGroupId = variant === "docker" ? "sidebar-nav-docker" : "sidebar-nav-main";
  const activeLayoutId = variant === "docker" ? "active-nav-docker" : "active-nav-main";

  const displayName = user
    ? `${user.firstName} ${user.lastName}`.trim() || user.email
    : "User";
  const initials =
    user && (user.firstName || user.lastName)
      ? `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase()
      : user?.email?.[0]?.toUpperCase() ?? "U";

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
    return location.startsWith(href);
  };

  return (
    <aside className="w-64 border-r border-border bg-card/30 backdrop-blur-xl fixed top-0 left-0 h-screen flex flex-col z-40">
      {/* Logo + compact mode switch */}
      <div className="flex-shrink-0 px-6 pt-8 pb-2">
        <Link
          href="/"
          scroll={false}
          className="flex items-start gap-3 rounded-xl -mx-1 px-1 py-0.5 hover:bg-white/[0.04] transition-colors"
        >
          <div
            className={`relative w-10 h-10 rounded-xl overflow-hidden border border-primary/20 shadow-[0_0_15px_rgba(255,255,255,0.08)] flex-shrink-0 ring-1 ring-white/5 ${
              variant === "docker" ? "bg-black" : ""
            }`}
          >
            <Image
              src={variant === "docker" ? "/weedocker-logo.png" : "/weehawk-logo.png"}
              alt={variant === "docker" ? "Weedocker" : "Weehawk"}
              width={40}
              height={40}
              className={variant === "docker" ? "object-contain size-10" : "object-cover size-10"}
              priority
            />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <h1 className="font-bold text-lg text-foreground tracking-tight leading-none">
              {variant === "docker" ? "Weedocker" : "Weehawk"}
            </h1>
            <p className="text-[10px] text-primary tracking-widest uppercase font-mono mt-1">
              {editionTag}
            </p>
          </div>
        </Link>

        {variant === "main" ? (
          <Link
            href="/docker"
            scroll={false}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-black py-1.5 pl-2 pr-2.5 text-[10px] font-medium leading-snug text-white transition-colors hover:border-white/45 hover:bg-zinc-950"
          >
            <ArrowRight className="size-3 shrink-0 opacity-90" strokeWidth={2.5} aria-hidden />
            <span>Switch to Weedocker</span>
          </Link>
        ) : (
          <Link
            href="/"
            scroll={false}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.04] py-1.5 pl-2 pr-2.5 text-[10px] font-medium leading-snug text-muted-foreground transition-colors hover:border-white/22 hover:bg-white/[0.07] hover:text-foreground"
          >
            <ArrowLeft className="size-3 shrink-0 opacity-70" strokeWidth={2} aria-hidden />
            <span>Switch to Weehawk</span>
          </Link>
        )}
      </div>

      {/* Scrollable nav */}
      <nav className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        <LayoutGroup id={layoutGroupId}>
          {variant === "docker" ? (
            <div className="mb-2">
              <p className="text-[10px] text-muted-foreground/40 tracking-widest uppercase font-mono px-4 mb-1 mt-0.5">
                Docker Manager
              </p>
              <div className="space-y-0.5">
                {dockerNavItems.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      scroll={false}
                      className={`relative flex items-center gap-3 px-4 py-2.5 rounded-xl transition-colors duration-200 group ${
                        active ? "text-primary" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                      }`}
                    >
                      {active && (
                        <motion.div
                          layoutId={activeLayoutId}
                          className="absolute inset-0 bg-primary/10 rounded-xl border border-primary/20"
                          initial={false}
                          transition={{ type: "spring", stiffness: 320, damping: 30 }}
                        />
                      )}
                      <item.icon className={`w-4 h-4 relative z-10 flex-shrink-0 ${active ? "text-primary" : "group-hover:text-foreground"}`} />
                      <span className="font-medium relative z-10 text-sm">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              {mainNavSections.map((section, sectionIndex) => (
                <div key={section.label} className="mb-2">
                  <p
                    className={`text-[10px] text-muted-foreground/40 tracking-widest uppercase font-mono px-4 mb-1 ${
                      sectionIndex === 0 ? "mt-0.5" : "mt-4"
                    }`}
                  >
                    {section.label}
                  </p>
                  <div className="space-y-0.5">
                    {section.items.map((item) => {
                      const active = isActive(item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          scroll={false}
                          className={`relative flex items-center gap-3 px-4 py-2.5 rounded-xl transition-colors duration-200 group ${
                            active ? "text-primary" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                          }`}
                        >
                          {active && (
                            <motion.div
                              layoutId={activeLayoutId}
                              className="absolute inset-0 bg-primary/10 rounded-xl border border-primary/20"
                              initial={false}
                              transition={{ type: "spring", stiffness: 320, damping: 30 }}
                            />
                          )}
                          <item.icon className={`w-4 h-4 relative z-10 flex-shrink-0 ${active ? "text-primary" : "group-hover:text-foreground"}`} />
                          <span className="font-medium relative z-10 text-sm">{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </>
          )}
        </LayoutGroup>
      </nav>

      {/* Profile */}
      <div className="flex-shrink-0 border-t border-white/5 p-3">
        <AnimatePresence>
          {profileOpen && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.15 }}
              className="mb-2 p-2 rounded-xl bg-card/60 border border-white/5"
            >
              <Link
                href="/profile"
                scroll={false}
                onClick={() => setProfileOpen(false)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  location === "/profile"
                    ? "text-primary bg-white/5"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                }`}
              >
                <UserCircle className="w-4 h-4" />Profile
              </Link>
              <div className="h-px bg-white/5 my-1" />
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

        <button
          onClick={() => setProfileOpen((v) => !v)}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors group"
        >
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/25 to-white/5 border border-primary/20 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-primary tracking-tight">{initials}</span>
          </div>
          <div className="flex-1 text-left min-w-0">
            <p className="text-sm font-semibold text-foreground leading-none truncate">{displayName}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{user?.email ?? ""}</p>
          </div>
          <motion.div animate={{ rotate: profileOpen ? 0 : 180 }} transition={{ duration: 0.2 }}
            className="text-muted-foreground group-hover:text-foreground transition-colors">
            <ChevronUp className="w-4 h-4" />
          </motion.div>
        </button>
      </div>
    </aside>
  );
}
