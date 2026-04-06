import ProjectsClient from "./projects/ProjectsClient";
import { fetchProjectsSSR } from "@/lib/server-fetch";
import type { ProjectsPageResponse } from "@/lib/projects-api";

/** Always run with the incoming request cookies (JWT). Avoids stale/cached RSC without auth. */
export const dynamic = "force-dynamic";

export default async function HomeProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const q = typeof sp.q === "string" ? sp.q : "";

  let initialPageData: ProjectsPageResponse | undefined;
  let initialError: string | null = null;

  try {
    initialPageData = await fetchProjectsSSR(page, q);
  } catch (e) {
    initialError = e instanceof Error ? e.message : "Unknown error";
  }

  return (
    <ProjectsClient
      urlPage={page}
      urlQ={q}
      initialPageData={initialPageData}
      initialError={initialError}
    />
  );
}
