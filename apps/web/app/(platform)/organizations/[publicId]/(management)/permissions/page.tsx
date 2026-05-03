import { fetchOrganizationMembersSSR } from "@/lib/server-fetch";
import { OrgPermissionsClient } from "./org-permissions-client";

type PageProps = {
  params: Promise<{ publicId: string }>;
};

export default async function OrganizationPermissionPage({ params }: PageProps) {
  const { publicId: raw } = await params;
  const publicId = raw.trim();
  const members = await fetchOrganizationMembersSSR(publicId);

  return (
    <OrgPermissionsClient organizationPublicId={publicId} initialMembers={members} />
  );
}
