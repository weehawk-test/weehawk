"use client";

import { useState } from "react";
import type { OrganizationPublic } from "@/lib/organizations-types";
import { OrgWorkspaceProvider } from "./org-workspace-context";
import {
  OrganizationMobileHeader,
  OrganizationSidebar,
} from "@/components/layout/organization-sidebar";

export function OrgWorkspaceShell({
  org,
  children,
}: {
  org: OrganizationPublic;
  children: React.ReactNode;
}) {
  const [mobileOrgNavOpen, setMobileOrgNavOpen] = useState(false);

  return (
    <OrgWorkspaceProvider org={org}>
      <OrganizationSidebar
        org={org}
        mobileOpen={mobileOrgNavOpen}
        onMobileOpenChange={setMobileOrgNavOpen}
      />

      <div className="space-y-6 md:space-y-8">
        <OrganizationMobileHeader org={org} onOpenMenu={() => setMobileOrgNavOpen(true)} />
        <div>{children}</div>
      </div>
    </OrgWorkspaceProvider>
  );
}
