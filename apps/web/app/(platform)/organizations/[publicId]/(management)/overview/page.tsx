import Link from "next/link";
import { FolderKanban, Users } from "lucide-react";
import { fetchOrganizationMembersSSR, fetchOrganizationProjectsSSR } from "@/lib/server-fetch";

type PageProps = {
  params: Promise<{ publicId: string }>;
};

export default async function OrganizationOverviewPage({ params }: PageProps) {
  const { publicId: raw } = await params;
  const publicId = raw.trim();
  const base = `/organizations/${encodeURIComponent(publicId)}`;
  const [members, projects] = await Promise.all([
    fetchOrganizationMembersSSR(publicId),
    fetchOrganizationProjectsSSR(publicId),
  ]);

  return (
    <div className="space-y-8">
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Manage membership, audit, access roles, and settings from the tabs above. Technical work (projects, servers,
        integrations) uses the same sidebar as your personal account, scoped to this organization where supported.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href={`${base}/projects`}
          className="group rounded-2xl border border-border/80 bg-card/30 p-5 transition-colors hover:border-primary/40 hover:bg-card/50"
        >
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <FolderKanban className="size-5" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Projects</p>
              <p className="text-2xl font-bold tabular-nums text-foreground">{projects.length}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Open the org project list and linked deployments.</p>
        </Link>

        <Link
          href={`${base}/members`}
          className="group rounded-2xl border border-border/80 bg-card/30 p-5 transition-colors hover:border-primary/40 hover:bg-card/50"
        >
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Users className="size-5" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Members</p>
              <p className="text-2xl font-bold tabular-nums text-foreground">{members.length}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Invite people and manage who can access this workspace.</p>
        </Link>
      </div>

      <p className="text-sm text-muted-foreground">
        Personal resources are unchanged — switch back from the sidebar via{" "}
        <Link href="/" className="font-medium text-primary hover:underline">
          Personal account
        </Link>
        .
      </p>
    </div>
  );
}
