import { fetchOrganizationMembersSSR } from "@/lib/server-fetch";
import { OrgMembersClient } from "./org-members-client";

type PageProps = {
  params: Promise<{ publicId: string }>;
};

export default async function OrganizationMembersPage({ params }: PageProps) {
  const { publicId: raw } = await params;
  const publicId = raw.trim();
  const members = await fetchOrganizationMembersSSR(publicId);

  return (
    <OrgMembersClient
      organizationPublicId={publicId}
      initialMembers={members}
      intro={
        <p className="text-sm text-muted-foreground md:max-w-2xl">
          Members listed here have accepted access to this organization. Invitations are sent by email; the recipient must already have a Weehawk account and accept the link while signed in with that email.
        </p>
      }
    />
  );
}
