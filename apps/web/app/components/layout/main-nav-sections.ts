import type { LucideIcon } from "lucide-react";
import {
  Webhook,
  FolderKanban,
  KeyRound,
  ImageIcon,
  Box,
  Database,
  Bell,
  HardDrive,
  Network,
  Boxes,
  ShieldCheck,
  Clock3,
  GitBranch,
  Server,
  Globe,
  Newspaper,
  Building2,
} from "lucide-react";

export type MainNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Opens in a new tab (e.g. docs). */
  external?: boolean;
};

export type MainNavSection = {
  label: string;
  items: MainNavItem[];
};

export function buildMainNavSections(): MainNavSection[] {
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
        { href: "/notifications", label: "Notifications", icon: Bell },
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
        { href: "/organizations", label: "Organizations", icon: Building2 },
        { href: "/news", label: "News", icon: Newspaper },
      ],
    },
  ];
}

export function buildDockerNavItems(base: string): { href: string; label: string; icon: LucideIcon }[] {
  return [
    { href: `${base}/images`, label: "Images", icon: ImageIcon },
    { href: `${base}/containers`, label: "Containers", icon: Box },
    { href: `${base}/services`, label: "Services", icon: Boxes },
    { href: `${base}/networks`, label: "Networks", icon: Network },
    { href: `${base}/secrets`, label: "Secrets", icon: KeyRound },
    { href: `${base}/volumes`, label: "Volumes", icon: Database },
  ];
}
