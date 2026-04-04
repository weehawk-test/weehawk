import { notFound, redirect } from "next/navigation";
import { parseConsoleServerSlug } from "@/lib/console-target";

export default async function ConsoleServerIndexPage({
  params,
}: {
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = await params;
  if (parseConsoleServerSlug(serverId) == null) notFound();
  redirect(`/console/${serverId}/containers`);
}
