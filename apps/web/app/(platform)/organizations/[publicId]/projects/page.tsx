import ProjectsClient from "../../../projects/ProjectsClient";
import { fetchProjectsSSR } from "@/lib/server-fetch";
import type { ProjectsPageResponse } from "@/lib/projects-api";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<{ page?: string; q?: string }>;
};

/** Same projects UI as the personal home list, scoped to this organization via API. */
export default async function OrganizationProjectsPage({ params, searchParams }: PageProps) {
  const { publicId: raw } = await params;
  const publicId = raw.trim();
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const q = typeof sp.q === "string" ? sp.q : "";

  let initialPageData: ProjectsPageResponse | undefined;
  let initialError: string | null = null;

  try {
    initialPageData = await fetchProjectsSSR(page, q, publicId);
  } catch (e) {
    initialError = e instanceof Error ? e.message : "Unknown error";
  }

  return (
    <ProjectsClient
      urlPage={page}
      urlQ={q}
      initialPageData={initialPageData}
      initialError={initialError}
      organizationPublicId={publicId}
      initialPageOrganizationId={publicId}
    />
  );
}
