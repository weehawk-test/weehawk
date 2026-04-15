import ProjectsIdClient from "./ProjectsIdClient";
import { fetchProjectSSR, fetchServicesPageSSR } from "@/lib/server-fetch";
import type { Project } from "@/lib/schema";
import type { ServicesPageResponse } from "@/lib/services-api";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
const PROJECT_SERVICES_SSR_TIMEOUT_MS = 900;

async function withSsrTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
    ]);
  } catch {
    return fallback;
  }
}

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

  const safeProjectId = rawId.trim() ? rawId.trim() : null;

  let initialProject: Project | null = null;
  let initialServicesPage: ServicesPageResponse | undefined;
  let initialProjectError: string | null = null;

  if (safeProjectId) {
    const [projectResult, servicesResult] = await Promise.all([
      fetchProjectSSR(safeProjectId),
      withSsrTimeout(
        fetchServicesPageSSR(safeProjectId, page, q),
        PROJECT_SERVICES_SSR_TIMEOUT_MS,
        undefined,
      ),
    ]);
    initialProject = projectResult;
    initialServicesPage = servicesResult;
    if (!initialProject) {
      initialProjectError = "Failed to fetch project from API.";
    } else if (initialProject.publicId && safeProjectId !== initialProject.publicId) {
      const params = new URLSearchParams();
      if (page > 1) params.set("page", String(page));
      if (q.trim()) params.set("q", q);
      const qs = params.toString();
      redirect(qs ? `/projects/${initialProject.publicId}?${qs}` : `/projects/${initialProject.publicId}`);
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
