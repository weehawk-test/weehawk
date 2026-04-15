import { type ReactNode } from "react";
import { redirect } from "next/navigation";
import { parseConsoleServerSlug } from "@/lib/console-target";

export default async function DockerManagerServerLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = await params;
  const target = parseConsoleServerSlug(serverId);
  /** Outside `(platform)` so the shell (sidebar) is not shown — `notFound()` would keep parent layouts. */
  if (target == null) redirect("/console-not-found");

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">
        <span className="text-muted-foreground">Weehawk · </span>
        <span className="font-medium text-foreground">Deploy server · {serverId}</span>
      </div>
      {children}
    </div>
  );
}
