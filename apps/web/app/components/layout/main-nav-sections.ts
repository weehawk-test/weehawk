import type { LucideIcon } from "lucide-react";
import type { OrgWorkspacePermissionKey } from "@/lib/org-workspace-permissions";
import {
  Webhook,
  House,
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
  Users,
  ClipboardList,
} from "lucide-react";
import {
  ORG_WORKSPACE_PERMISSIONS,
  orgMemberHasAnyOrgManagementTab,
} from "@/lib/org-workspace-permissions";
import type { OrganizationPublic } from "@/lib/organizations-types";

export type MainNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Opens in a new tab (e.g. docs). */
  external?: boolean;
  /** In an organization workspace, non-owners see the row faded/disabled when this permission is false. */
  orgPermission?: OrgWorkspacePermissionKey;
  /**
   * Organization “Management” entry: non-owners need `orgPermission` plus at least one allowed
   * management sub-tab; otherwise the row is shown disabled.
   */
  orgManagementEntry?: boolean;
};

export type MainNavSection = {
  label: string;
  items: MainNavItem[];
};

/** Non-owners: disabled when the workspace permission (or management sub-tabs) is not allowed. */
export function isOrgMainNavItemDisabled(org: OrganizationPublic, item: MainNavItem): boolean {
  if (org.isOwner) return false;
  if (item.orgPermission == null) return false;
  if (!org.workspacePermissions[item.orgPermission]) return true;
  if (item.orgManagementEntry && !orgMemberHasAnyOrgManagementTab(org.workspacePermissions)) {
    return true;
  }
  return false;
}

export function buildMainNavSections(): MainNavSection[] {
  return [
    {
      label: "General",
      items: [
        { href: "/home", label: "Home", icon: House },
        {
          href: "/projects",
          label: "Projects",
          icon: FolderKanban,
          orgPermission: ORG_WORKSPACE_PERMISSIONS.PROJECTS,
        },
        {
          href: "/remote-server",
          label: "Servers",
          icon: Server,
          orgPermission: ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER,
        },
      ],
    },
    {
      label: "Integrations",
      items: [
        { href: "/webhooks", label: "Webhooks", icon: Webhook, orgPermission: ORG_WORKSPACE_PERMISSIONS.WEBHOOKS },
        {
          href: "/cron-jobs",
          label: "Cron Jobs",
          icon: Clock3,
          orgPermission: ORG_WORKSPACE_PERMISSIONS.CRON_JOBS,
        },
        {
          href: "/notifications",
          label: "Notifications",
          icon: Bell,
          orgPermission: ORG_WORKSPACE_PERMISSIONS.NOTIFICATIONS,
        },
        { href: "/s3", label: "S3 Destinations", icon: HardDrive, orgPermission: ORG_WORKSPACE_PERMISSIONS.S3 },
      ],
    },
    {
      label: "Registry & Git",
      items: [
        { href: "/registry", label: "Registry", icon: ShieldCheck, orgPermission: ORG_WORKSPACE_PERMISSIONS.REGISTRY },
        { href: "/git", label: "Git", icon: GitBranch, orgPermission: ORG_WORKSPACE_PERMISSIONS.GIT },
      ],
    },
    {
      label: "Organization",
      items: [
        {
          href: "/organization/members",
          label: "Members",
          icon: Users,
          orgPermission: ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT,
          orgManagementEntry: true,
        },
        {
          href: "/organization/audit",
          label: "Audit logs",
          icon: ClipboardList,
          orgPermission: ORG_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT,
          orgManagementEntry: true,
        },
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
