import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";
import { CreateS3ProfileClient } from "./create-s3-profile-client";

export const dynamic = "force-dynamic";

export default async function CreateS3ProfilePage() {
  const orgPid = await getServerActiveOrganizationPublicId();
  return <CreateS3ProfileClient activeOrgPublicId={orgPid ?? undefined} />;
}
