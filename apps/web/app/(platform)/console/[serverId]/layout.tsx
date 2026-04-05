import { type ReactNode } from "react";
import { notFound } from "next/navigation";
import { parseConsoleServerSlug } from "@/lib/console-target";
import { isCloudEdition } from "@/lib/weehawk-edition";

export default async function ConsoleServerLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = await params;
  if (isCloudEdition() && serverId === "local") {
    notFound();
  }
  const target = parseConsoleServerSlug(serverId);
  if (target == null) notFound();

  const label =
    serverId === "local" ? "Docker on the API host (local)" : `Remote server #${serverId}`;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">
        <span className="text-muted-foreground">WeeDocker · </span>
        <span className="font-medium text-foreground">{label}</span>
      </div>
      {children}
    </div>
  );
}
