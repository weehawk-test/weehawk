import { redirect } from "next/navigation";
import { fetchOrganizationSSR } from "@/lib/server-fetch";
import { OrgWorkspaceShell } from "./org-workspace-shell";

export const dynamic = "force-dynamic";

export default async function OrganizationWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ publicId: string }>;
}) {
  const { publicId: raw } = await params;
  const publicId = raw.trim();
  const org = await fetchOrganizationSSR(publicId);
  if (!org) redirect("/resource-not-found");
  if (org.publicId && publicId !== org.publicId) {
    redirect(`/organizations/${encodeURIComponent(org.publicId)}/projects`);
  }

  return <OrgWorkspaceShell org={org}>{children}</OrgWorkspaceShell>;
}
