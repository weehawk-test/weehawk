import { notFound, redirect } from "next/navigation";
import { redirectOrgWorkspaceAccessDenied } from "@/lib/org-workspace-access-denied";
import { RemoteServerSettingsClient } from "../../../remote-server/remote-server-settings-client";
import { DeployDomainsClient } from "../../../domains/deploy-domains-client";
import {
  fetchCronJobSSR,
  fetchNotificationChannelsSSR,
  fetchOrganizationSSR,
  fetchRemoteServersSSR,
  fetchS3BucketObjectsSSR,
  fetchS3PrefixSummarySSR,
  fetchS3ProfilesSSR,
  fetchTraefikSettingsSSR,
  fetchWebhookSSR,
} from "@/lib/server-fetch";
import type { S3PrefixSummaryResponse } from "@/lib/s3-api";
import { s3PathSegmentsToPrefix } from "@/lib/s3-prefix-param";
import { S3BucketBrowser } from "@/components/s3/S3BucketBrowser";
import {
  ORG_WORKSPACE_PERMISSIONS,
  type OrgWorkspacePermissionKey,
} from "@/lib/org-workspace-permissions";
import { WebhooksPageInner } from "../../../webhooks/page";
import { CronJobsPageInner } from "../../../cron-jobs/page";
import { CreateWebhookClient } from "../../../webhooks/create/create-webhook-client";
import { EditWebhookClient } from "../../../webhooks/[id]/edit/edit-webhook-client";
import { CreateCronJobClient } from "../../../cron-jobs/create/create-cron-job-client";
import { EditCronJobClient } from "../../../cron-jobs/[id]/edit/edit-cron-job-client";
import { CreateS3ProfileClient } from "../../../s3/create/create-s3-profile-client";
import { EditS3ProfileClient } from "../../../s3/[id]/edit/edit-s3-profile-client";
import { NotificationsTabs } from "../../../notifications/notifications-tabs";
import { NotificationsListView } from "../../../notifications/page";
import { NotificationsCreateView } from "../../../notifications/create/page";
import { NotificationsEditView } from "../../../notifications/[id]/edit/page";
import S3Page from "../../../s3/page";
import RegistryPage from "../../../registry/page";
import GitPage from "../../../git/page";
import NewsPage from "../../../news/page";
import SecretsPage from "../../../secrets/page";
import ProjectDetailsPage from "../../../projects/[id]/page";
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ publicId: string; slug: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Renders the same platform pages as the personal account, under `/organizations/:publicId/...`
 * so the org workspace sidebar stays mounted. Add new cases when introducing top-level routes.
 */
export default async function OrganizationWorkspaceMirrorPage({ params, searchParams }: Props) {
  const { publicId, slug } = await params;
  const sp = await searchParams;
  const orgPrefix = `/organizations/${encodeURIComponent(publicId)}`;

  if (!slug?.length) notFound();

  const orgWorkspace = await fetchOrganizationSSR(publicId.trim());
  if (!orgWorkspace) notFound();
  const perm = orgWorkspace.workspacePermissions;
  const orgIdForDenial = publicId.trim();
  const requirePerm = (key: OrgWorkspacePermissionKey) => {
    if (!perm[key]) {
      redirectOrgWorkspaceAccessDenied(orgIdForDenial, key);
    }
  };

  const path = slug.join("/");

  if (slug.length === 2 && slug[0] === "projects") {
    requirePerm(ORG_WORKSPACE_PERMISSIONS.PROJECTS);
    requirePerm(ORG_WORKSPACE_PERMISSIONS.PROJECTS_VIEW);
    return (
      <ProjectDetailsPage
        params={Promise.resolve({ id: slug[1] })}
        searchParams={Promise.resolve({
          page: typeof sp.page === "string" ? sp.page : undefined,
          q: typeof sp.q === "string" ? sp.q : undefined,
        })}
        organizationPublicId={publicId}
      />
    );
  }

  const notificationsBase = `${orgPrefix}/notifications`;

  if (path === "notifications/create") {
    requirePerm(ORG_WORKSPACE_PERMISSIONS.NOTIFICATIONS);
    requirePerm(ORG_WORKSPACE_PERMISSIONS.NOTIFICATIONS_ADD);
    return (
      <>
        <NotificationsTabs basePath={notificationsBase} />
        <NotificationsCreateView notificationsBasePath={notificationsBase} />
      </>
    );
  }

  if (slug.length === 3 && slug[0] === "notifications" && slug[2] === "edit") {
    requirePerm(ORG_WORKSPACE_PERMISSIONS.NOTIFICATIONS);
    requirePerm(ORG_WORKSPACE_PERMISSIONS.NOTIFICATIONS_EDIT);
    return (
      <>
        <NotificationsTabs basePath={notificationsBase} />
        <NotificationsEditView
          params={Promise.resolve({ id: slug[1] ?? "" })}
          notificationsBasePath={notificationsBase}
        />
      </>
    );
  }

  if (slug.length === 3 && slug[0] === "webhooks" && slug[2] === "edit") {
    requirePerm(ORG_WORKSPACE_PERMISSIONS.WEBHOOKS);
    requirePerm(ORG_WORKSPACE_PERMISSIONS.WEBHOOKS_EDIT);
    const rawId = slug[1] ?? "";
    const [webhook, initialChannels, initialRemoteServers] = await Promise.all([
      fetchWebhookSSR(rawId, publicId),
      fetchNotificationChannelsSSR(publicId),
      fetchRemoteServersSSR(publicId),
    ]);
    if (!webhook) notFound();
    if (webhook.publicId && rawId !== webhook.publicId) {
      redirect(`${orgPrefix}/webhooks/${encodeURIComponent(webhook.publicId)}/edit`);
    }
    return (
      <EditWebhookClient
        initialWebhook={webhook}
        initialChannels={initialChannels}
        initialRemoteServers={initialRemoteServers}
        organizationPublicId={publicId}
      />
    );
  }

  if (slug.length === 3 && slug[0] === "cron-jobs" && slug[2] === "edit") {
    requirePerm(ORG_WORKSPACE_PERMISSIONS.CRON_JOBS);
    requirePerm(ORG_WORKSPACE_PERMISSIONS.CRON_JOBS_EDIT);
    const rawId = slug[1] ?? "";
    const [cronJob, initialChannels, initialRemoteServers] = await Promise.all([
      fetchCronJobSSR(rawId, publicId),
      fetchNotificationChannelsSSR(publicId),
      fetchRemoteServersSSR(publicId),
    ]);
    if (!cronJob) notFound();
    if (cronJob.publicId && rawId !== cronJob.publicId) {
      redirect(`${orgPrefix}/cron-jobs/${encodeURIComponent(cronJob.publicId)}/edit`);
    }
    return (
      <EditCronJobClient
        initialCronJob={cronJob}
        initialChannels={initialChannels}
        initialRemoteServers={initialRemoteServers}
        organizationPublicId={publicId}
      />
    );
  }

  if (path === "cron-jobs/create") {
    requirePerm(ORG_WORKSPACE_PERMISSIONS.CRON_JOBS);
    requirePerm(ORG_WORKSPACE_PERMISSIONS.CRON_JOBS_ADD);
    const [initialChannels, initialRemoteServers] = await Promise.all([
      fetchNotificationChannelsSSR(publicId),
      fetchRemoteServersSSR(publicId),
    ]);
    return (
      <CreateCronJobClient
        initialChannels={initialChannels}
        initialRemoteServers={initialRemoteServers}
        organizationPublicId={publicId}
      />
    );
  }

  if (path === "webhooks/create") {
    requirePerm(ORG_WORKSPACE_PERMISSIONS.WEBHOOKS);
    requirePerm(ORG_WORKSPACE_PERMISSIONS.WEBHOOKS_ADD);
    const [initialChannels, initialRemoteServers] = await Promise.all([
      fetchNotificationChannelsSSR(publicId),
      fetchRemoteServersSSR(publicId),
    ]);
    return (
      <CreateWebhookClient
        initialChannels={initialChannels}
        initialRemoteServers={initialRemoteServers}
        organizationPublicId={publicId}
      />
    );
  }

  if (path === "s3/create") {
    requirePerm(ORG_WORKSPACE_PERMISSIONS.S3);
    requirePerm(ORG_WORKSPACE_PERMISSIONS.S3_ADD);
    return <CreateS3ProfileClient organizationPublicId={publicId} />;
  }

  if (slug.length === 3 && slug[0] === "s3" && slug[2] === "edit") {
    requirePerm(ORG_WORKSPACE_PERMISSIONS.S3);
    requirePerm(ORG_WORKSPACE_PERMISSIONS.S3_EDIT);
    const id = (slug[1] ?? "").trim();
    const profiles = await fetchS3ProfilesSSR(publicId);
    const profile = profiles.find((p) => (p.publicId ?? "").trim() === id);
    if (!profile) notFound();
    return <EditS3ProfileClient profile={profile} organizationPublicId={publicId} />;
  }

  if (
    slug[0] === "s3" &&
    slug.length >= 2 &&
    !(slug.length === 2 && slug[1] === "create")
  ) {
    requirePerm(ORG_WORKSPACE_PERMISSIONS.S3);
    requirePerm(ORG_WORKSPACE_PERMISSIONS.S3_BROWSE);
    const profileSeg = decodeURIComponent((slug[1] ?? "").trim());
    if (!profileSeg) notFound();
    const prefixParam = s3PathSegmentsToPrefix(slug.slice(2));
    const initialList = await fetchS3BucketObjectsSSR(profileSeg, prefixParam, publicId);
    const initialFolderSummaries: Record<string, S3PrefixSummaryResponse> = {};
    if (initialList?.folders?.length) {
      const results = await Promise.all(
        initialList.folders.map(async (f) => {
          const s = await fetchS3PrefixSummarySSR(profileSeg, f.prefix, publicId);
          return [f.prefix, s] as const;
        }),
      );
      for (const [pfx, s] of results) {
        if (s) initialFolderSummaries[pfx] = s;
      }
    }
    return (
      <S3BucketBrowser
        key={`${profileSeg}:${prefixParam}`}
        profileName={profileSeg}
        initialPrefix={prefixParam}
        initialList={initialList}
        initialFolderSummaries={initialFolderSummaries}
        organizationPublicId={publicId}
      />
    );
  }

  if (slug.length !== 1) {
    notFound();
  }

  switch (slug[0]) {
    case "remote-server": {
      requirePerm(ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER);
      const [initialRemoteServers, initialTraefikSettings] = await Promise.all([
        fetchRemoteServersSSR(publicId),
        fetchTraefikSettingsSSR(),
      ]);
      return (
        <RemoteServerSettingsClient
          initialRemoteServers={initialRemoteServers}
          initialTraefikSettings={initialTraefikSettings}
          organizationPublicId={publicId}
        />
      );
    }
    case "domains": {
      requirePerm(ORG_WORKSPACE_PERMISSIONS.DOMAINS);
      const [initialRemoteServers, initialTraefikSettings] = await Promise.all([
        fetchRemoteServersSSR(publicId),
        fetchTraefikSettingsSSR(),
      ]);
      return (
        <DeployDomainsClient
          initialRemoteServers={initialRemoteServers}
          initialTraefikSettings={initialTraefikSettings}
          organizationPublicId={publicId}
        />
      );
    }
    case "webhooks":
      requirePerm(ORG_WORKSPACE_PERMISSIONS.WEBHOOKS);
      return <WebhooksPageInner organizationPublicId={publicId} />;
    case "cron-jobs":
      requirePerm(ORG_WORKSPACE_PERMISSIONS.CRON_JOBS);
      return <CronJobsPageInner organizationPublicId={publicId} />;
    case "notifications":
      requirePerm(ORG_WORKSPACE_PERMISSIONS.NOTIFICATIONS);
      return (
        <>
          <NotificationsTabs basePath={notificationsBase} />
          <NotificationsListView
            searchParams={Promise.resolve({
              page: typeof sp.page === "string" ? sp.page : undefined,
              q: typeof sp.q === "string" ? sp.q : undefined,
            })}
            notificationsBasePath={notificationsBase}
            organizationPublicId={publicId}
          />
        </>
      );
    case "s3":
      requirePerm(ORG_WORKSPACE_PERMISSIONS.S3);
      requirePerm(ORG_WORKSPACE_PERMISSIONS.S3_BROWSE);
      return <S3Page organizationPublicId={publicId} />;
    case "registry":
      requirePerm(ORG_WORKSPACE_PERMISSIONS.REGISTRY);
      return <RegistryPage />;
    case "git":
      requirePerm(ORG_WORKSPACE_PERMISSIONS.GIT);
      return <GitPage />;
    case "news":
      return <NewsPage />;
    case "secrets":
      return (
        <SecretsPage
          searchParams={Promise.resolve({
            page: typeof sp.page === "string" ? sp.page : undefined,
            q: typeof sp.q === "string" ? sp.q : undefined,
            server: typeof sp.server === "string" ? sp.server : undefined,
          })}
          organizationPublicId={publicId}
        />
      );
    case "docker":
      requirePerm(ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER);
      return redirect(`${orgPrefix}/remote-server`);
    default:
      notFound();
  }
}
