import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ publicId: string }>;
};

/** Org workspace home: send users to Projects; management Overview lives at `/overview`. */
export default async function OrganizationWorkspaceRootPage({ params }: PageProps) {
  const { publicId: raw } = await params;
  const publicId = raw.trim();
  redirect(`/organizations/${encodeURIComponent(publicId)}/projects`);
}
