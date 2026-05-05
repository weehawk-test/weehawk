"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { OrganizationPublic } from "@/lib/organizations-types";
import { OrgWorkspaceProvider } from "./org-workspace-context";
import {
  OrganizationMobileHeader,
  OrganizationSidebar,
} from "@/components/layout/organization-sidebar";
import { OrgRealtimeSync } from "./org-realtime-sync";
import { isPlatformPathExemptFromOrgWorkspaceShell } from "@/lib/platform-shell-path";

export function OrgWorkspaceShell({
  org,
  children,
}: {
  org: OrganizationPublic;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  if (isPlatformPathExemptFromOrgWorkspaceShell(pathname ?? "")) {
    return <>{children}</>;
  }

  const [mobileOrgNavOpen, setMobileOrgNavOpen] = useState(false);

  return (
    <OrgWorkspaceProvider key={org.publicId} org={org}>
      <OrgRealtimeSync />
      <OrganizationSidebar
        org={org}
        mobileOpen={mobileOrgNavOpen}
        onMobileOpenChange={setMobileOrgNavOpen}
      />

      <div
        className={cn(
          "md:space-y-0",
          !mobileOrgNavOpen && "max-md:space-y-6",
        )}
      >
        <OrganizationMobileHeader
          org={org}
          menuOpen={mobileOrgNavOpen}
          onOpenMenu={() => setMobileOrgNavOpen(true)}
        />
        <div className="max-w-6xl mx-auto px-4 pb-6 md:px-8 md:pb-8 md:pt-8">
          <div className="space-y-6 md:space-y-8">{children}</div>
        </div>
      </div>
    </OrgWorkspaceProvider>
  );
}
