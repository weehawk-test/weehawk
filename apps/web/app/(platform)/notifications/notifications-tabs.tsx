"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { useOptionalOrgWorkspace } from "@/(platform)/organizations/[publicId]/org-workspace-context";
import { orgMemberAllowsNotificationsAdd } from "@/lib/org-workspace-permissions";

const DEFAULT_BASE = "/notifications";

function normalizeBase(raw?: string): string {
  const b = (raw ?? DEFAULT_BASE).trim().replace(/\/$/, "");
  return b || DEFAULT_BASE;
}

export function NotificationsTabs({ basePath }: { basePath?: string }) {
  const base = normalizeBase(basePath);
  const orgWorkspace = useOptionalOrgWorkspace();
  const inOrg = orgWorkspace != null;
  const allowAdd =
    !inOrg ||
    orgMemberAllowsNotificationsAdd(orgWorkspace.workspacePermissions);
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-10">
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Notifications</h1>
        <p className="text-muted-foreground">
          Manage channels. Delivery and tests run only on deploy servers over SSH.
        </p>
      </div>
      {allowAdd ? (
        <Link
          href={`${base}/create`}
          className="btn-primary flex w-full items-center justify-center gap-2 md:w-auto"
        >
          <Plus className="w-5 h-5" />
          Add Channel
        </Link>
      ) : (
        <span
          className="inline-flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-4 py-2 text-sm text-muted-foreground md:w-auto"
          title="Your role cannot add notification channels in this organization"
        >
          <Plus className="w-5 h-5" />
          Add Channel
        </span>
      )}
    </div>
  );
}
