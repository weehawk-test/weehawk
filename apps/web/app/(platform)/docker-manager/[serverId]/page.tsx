import { redirect } from "next/navigation";
import { parseConsoleServerSlug } from "@/lib/console-target";

export default async function DockerManagerServerIndexPage({
  params,
}: {
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = await params;
  if (parseConsoleServerSlug(serverId) == null) redirect("/resource-not-found");
  redirect(`/docker-manager/${serverId}/images`);
}
