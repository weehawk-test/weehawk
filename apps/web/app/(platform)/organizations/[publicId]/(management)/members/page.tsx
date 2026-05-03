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
          Teammates listed here can work in this organization after you invite them. They sign in with the same Weehawk email and password they already use—no extra account.
        </p>
      }
    />
  );
}
