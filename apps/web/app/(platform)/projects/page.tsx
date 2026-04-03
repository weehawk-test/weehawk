import ProjectsClient from "./ProjectsClient";
import { fetchProjectsSSR } from "@/lib/server-fetch";
import type { ProjectsPageResponse } from "@/lib/projects-api";

export default async function ProjectsPage({
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
