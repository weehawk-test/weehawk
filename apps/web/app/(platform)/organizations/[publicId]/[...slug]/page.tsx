import { notFound, redirect } from "next/navigation";
import RemoteServerPage from "../../../remote-server/page";
import DomainsPage from "../../../domains/page";
import WebhooksPage from "../../../webhooks/page";
import CronJobsPage from "../../../cron-jobs/page";
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
import CronJobsCreatePage from "../../../cron-jobs/create/page";
import WebhooksCreatePage from "../../../webhooks/create/page";

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

  const path = slug.join("/");

  if (slug.length === 2 && slug[0] === "projects") {
    return (
      <ProjectDetailsPage
        params={Promise.resolve({ id: slug[1] })}
        searchParams={Promise.resolve({
          page: typeof sp.page === "string" ? sp.page : undefined,
          q: typeof sp.q === "string" ? sp.q : undefined,
        })}
      />
    );
  }

  if (path === "cron-jobs/create") {
    return <CronJobsCreatePage />;
  }

  if (path === "webhooks/create") {
    return <WebhooksCreatePage />;
  }

  const notificationsBase = `${orgPrefix}/notifications`;

  if (path === "notifications/create") {
    return (
      <>
        <NotificationsTabs basePath={notificationsBase} />
        <NotificationsCreateView notificationsBasePath={notificationsBase} />
      </>
    );
  }

  if (slug.length === 3 && slug[0] === "notifications" && slug[2] === "edit") {
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

  if (slug.length !== 1) {
    notFound();
  }

  switch (slug[0]) {
    case "remote-server":
      return <RemoteServerPage />;
    case "domains":
      return <DomainsPage />;
    case "webhooks":
      return <WebhooksPage />;
    case "cron-jobs":
      return <CronJobsPage />;
    case "notifications":
      return (
        <>
          <NotificationsTabs basePath={notificationsBase} />
          <NotificationsListView
            searchParams={Promise.resolve({
              page: typeof sp.page === "string" ? sp.page : undefined,
              q: typeof sp.q === "string" ? sp.q : undefined,
            })}
            notificationsBasePath={notificationsBase}
          />
        </>
      );
    case "s3":
      return <S3Page />;
    case "registry":
      return <RegistryPage />;
    case "git":
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
        />
      );
    case "docker":
      return redirect(`${orgPrefix}/remote-server`);
    default:
      notFound();
  }
}
