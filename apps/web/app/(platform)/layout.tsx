import { AppLayout } from "@/components/layout/AppLayout";
import { OrgWorkspaceShell } from "./org-workspace/org-workspace-shell";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { isPlatformPathExemptFromOrgWorkspaceShell } from "@/lib/platform-shell-path";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";
import { fetchOrganizationSSR } from "@/lib/server-fetch";

const PATHNAME_HEADER = "x-weehawk-pathname";

/**
 * Org workspace uses flat URLs (`/projects`, …) + active-org cookie; legacy `/organizations/:id/*`
 * is redirected in middleware. Exempt routes keep the personal shell only.
 */
export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const initialSidebarCollapsed = cookieStore.get("weehawk-sidebar-collapsed")?.value === "1";
  const initialMobileNavOpen = cookieStore.get("weehawk-sidebar-mobile-open")?.value === "1";

  const h = await headers();
  const pathname = h.get(PATHNAME_HEADER) ?? "";
  if (isPlatformPathExemptFromOrgWorkspaceShell(pathname)) {
    /**
     * Exempt routes (e.g. `/docker-manager/...`, `/profile`) render the personal Sidebar,
     * not the OrganizationSidebar. Resolve the active org SSR-side so the workspace switcher
     * shows the correct organization name on first paint (no client fetch flicker).
     */
    const exemptOrgId = await getServerActiveOrganizationPublicId().catch(() => null);
    const exemptOrg = exemptOrgId
      ? await fetchOrganizationSSR(exemptOrgId).catch(() => null)
      : null;
    const initialActiveOrg = exemptOrg
      ? { publicId: exemptOrg.publicId, name: exemptOrg.name }
      : null;
    return (
      <AppLayout
        initialSidebarCollapsed={initialSidebarCollapsed}
        initialMobileNavOpen={initialMobileNavOpen}
        initialActiveOrg={initialActiveOrg}
      >
        {children}
      </AppLayout>
    );
  }

  const orgId = await getServerActiveOrganizationPublicId();
  if (!orgId) {
    redirect("/organizations/create");
  }
  const org = await fetchOrganizationSSR(orgId);
  if (!org) {
    redirect("/organizations/create");
  }

  return (
    <AppLayout
      initialSidebarCollapsed={initialSidebarCollapsed}
      initialMobileNavOpen={initialMobileNavOpen}
      initialActiveOrg={{ publicId: org.publicId, name: org.name }}
    >
      <OrgWorkspaceShell org={org}>{children}</OrgWorkspaceShell>
    </AppLayout>
  );
}
