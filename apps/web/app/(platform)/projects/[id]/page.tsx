import ProjectsIdClient from "./ProjectsIdClient";
import { fetchProjectSSR, fetchServicesPageSSR } from "@/lib/server-fetch";
import type { Project } from "@/lib/schema";
import type { ServicesPageResponse } from "@/lib/services-api";

export const dynamic = "force-dynamic";

export default async function ProjectDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const { id: rawId } = await params;
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const q = typeof sp.q === "string" ? sp.q : "";

  const parsedId = Number(rawId);
  const safeProjectId = Number.isNaN(parsedId) ? null : String(parsedId);

  let initialProject: Project | null = null;
  let initialServicesPage: ServicesPageResponse | undefined;
  let initialProjectError: string | null = null;

  if (safeProjectId) {
    try {
      initialProject = await fetchProjectSSR(safeProjectId);
      if (!initialProject) {
        initialProjectError = "Failed to fetch project from API.";
      }
    } catch (e) {
      initialProject = null;
      initialProjectError = e instanceof Error ? e.message : "Failed to fetch project from API.";
    }

    try {
      initialServicesPage = await fetchServicesPageSSR(safeProjectId, page, q);
    } catch {
      initialServicesPage = undefined;
    }
  }

  return (
    <ProjectsIdClient
      projectId={safeProjectId ?? rawId}
      initialProject={initialProject}
      initialServicesPage={initialServicesPage}
      initialProjectError={initialProjectError}
      urlPage={page}
      urlQ={q}
    />
  );
}
