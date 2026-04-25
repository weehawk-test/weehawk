import { redirect } from "next/navigation";
import { fetchS3ProfilesSSR } from "@/lib/server-fetch";
import { EditS3ProfileClient } from "./edit-s3-profile-client";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditS3ProfilePage({ params }: PageProps) {
  const { id: rawId } = await params;
  const id = rawId.trim();
  const profiles = await fetchS3ProfilesSSR();
  const profile = profiles.find((p) => (p.publicId ?? "").trim() === id);
  if (!profile) redirect("/resource-not-found");

  return <EditS3ProfileClient profile={profile} />;
}
