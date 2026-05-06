import Link from "next/link";
import { Boxes, Clock3, FolderKanban, Server, Users, Webhook } from "lucide-react";
import {
  fetchCronJobsSSR,
  fetchOrganizationMembersSSR,
  fetchOrganizationProjectsSSR,
  fetchOrganizationSSR,
  fetchRemoteServersSSR,
  fetchWebhooksSSR,
} from "@/lib/server-fetch";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";
import { ORGANIZATION_MANAGEMENT_BASE } from "@/lib/org-nav-utils";

export default async function HomePage() {
  const publicId = await getServerActiveOrganizationPublicId();
  if (!publicId?.trim()) {
    return (
      <div className="space-y-3">
        <h1 className="text-3xl font-bold text-foreground">Home</h1>
        <p className="text-sm text-muted-foreground">
          Select or create an organization first to start using your workspace.
        </p>
        <Link href="/organizations" className="text-sm font-medium text-primary hover:underline">
          Open organizations
        </Link>
      </div>
    );
  }

  const [org, projects, members, servers, cronJobs, webhooks] = await Promise.all([
    fetchOrganizationSSR(publicId),
    fetchOrganizationProjectsSSR(publicId),
    fetchOrganizationMembersSSR(publicId),
    fetchRemoteServersSSR(publicId),
    fetchCronJobsSSR(publicId),
    fetchWebhooksSSR(publicId),
  ]);

  const orgName = org?.name?.trim() || "Organization";
  const memberCount = org?.memberCount ?? members.length;
  const servicesCount = projects.reduce((sum, project) => sum + Math.max(0, project.serviceCount ?? 0), 0);
  const latestProjects = [...projects]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 3);
  const latestServers = [...servers]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 3);
  const latestCronJobs = [...cronJobs]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 3);
  const latestWebhooks = [...webhooks]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 3);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Home</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Quick overview for <span className="font-medium text-foreground">{orgName}</span>. See stats for projects,
          servers, services, members, cron jobs, and webhooks from one place.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-border/80 bg-card/30 p-5">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <FolderKanban className="size-5" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Projects</p>
              <p className="text-2xl font-bold tabular-nums text-foreground">{projects.length}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Total projects in this organization.</p>
        </div>

        <div className="rounded-2xl border border-border/80 bg-card/30 p-5">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Server className="size-5" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Servers</p>
              <p className="text-2xl font-bold tabular-nums text-foreground">{servers.length}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Total servers in this organization.</p>
        </div>

        <div className="rounded-2xl border border-border/80 bg-card/30 p-5">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Boxes className="size-5" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Services</p>
              <p className="text-2xl font-bold tabular-nums text-foreground">{servicesCount}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Total services in this organization.</p>
        </div>

        <div className="rounded-2xl border border-border/80 bg-card/30 p-5">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Users className="size-5" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Members</p>
              <p className="text-2xl font-bold tabular-nums text-foreground">{memberCount}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Total members in this organization.</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="flex flex-col rounded-2xl border border-border/80 bg-card/30 shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
            <div className="flex min-w-0 items-center gap-2">
              <Server className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <h2 className="truncate text-sm font-semibold text-foreground">Latest servers</h2>
            </div>
            <Link href="/remote-server" className="shrink-0 text-xs font-medium text-primary hover:underline">
              View all
            </Link>
          </div>
          <div className="flex flex-1 flex-col px-5 py-3">
            {latestServers.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No servers yet. Add your first remote server.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {latestServers.map((server) => {
                  return (
                    <li
                      key={server.publicId?.trim() || String(server.id)}
                      className="py-2.5 text-sm first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{server.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {server.sshUser}@{server.host}:{server.port}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="flex flex-col rounded-2xl border border-border/80 bg-card/30 shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
            <div className="flex min-w-0 items-center gap-2">
              <FolderKanban className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <h2 className="truncate text-sm font-semibold text-foreground">Latest projects</h2>
            </div>
            <Link href="/projects" className="shrink-0 text-xs font-medium text-primary hover:underline">
              View all
            </Link>
          </div>
          <div className="flex flex-1 flex-col px-5 py-3">
            {latestProjects.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No projects yet. Create your first project.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {latestProjects.map((project) => (
                  <li
                    key={project.publicId}
                    className="py-2.5 text-sm first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{project.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {project.serviceCount} services
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="flex flex-col rounded-2xl border border-border/80 bg-card/30 shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
            <div className="flex min-w-0 items-center gap-2">
              <Clock3 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <h2 className="truncate text-sm font-semibold text-foreground">Latest cron jobs</h2>
            </div>
            <Link href="/cron-jobs" className="shrink-0 text-xs font-medium text-primary hover:underline">
              View all
            </Link>
          </div>
          <div className="flex flex-1 flex-col px-5 py-3">
            {latestCronJobs.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No cron jobs yet.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {latestCronJobs.map((job) => {
                  const jobId = job.publicId?.trim() || String(job.id);
                  return (
                    <li
                      key={jobId}
                      className="py-2.5 text-sm first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{job.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{job.cronExpression}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="flex flex-col rounded-2xl border border-border/80 bg-card/30 shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
            <div className="flex min-w-0 items-center gap-2">
              <Webhook className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <h2 className="truncate text-sm font-semibold text-foreground">Latest webhooks</h2>
            </div>
            <Link href="/webhooks" className="shrink-0 text-xs font-medium text-primary hover:underline">
              View all
            </Link>
          </div>
          <div className="flex flex-1 flex-col px-5 py-3">
            {latestWebhooks.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No webhooks yet.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {latestWebhooks.map((hook) => {
                  const hookId = hook.publicId?.trim() || String(hook.id);
                  return (
                    <li
                      key={hookId}
                      className="py-2.5 text-sm first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{hook.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{hook.summary}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

    </div>
  );
}
