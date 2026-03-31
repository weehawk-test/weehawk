import { redirect } from "next/navigation";
import { fetchUserProfileSSR } from "@/lib/ssr/fetch-user-profile";
import { ProfileClient } from "./profile-client";

export default async function ProfilePage() {
  const initialProfile = await fetchUserProfileSSR();
  if (!initialProfile) redirect("/auth");
  return <ProfileClient initialProfile={initialProfile} />;
}
