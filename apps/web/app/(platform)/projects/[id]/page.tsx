import ProjectsIdClient from "./ProjectsIdClient";
import { fetchProjectSSR, fetchServicesPageSSR } from "@/lib/server-fetch";
import type { Project } from "@/lib/schema";
import type { ServicesPageResponse } from "@/lib/services-api";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";
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
  activeOrgPublicId: activeOrgPublicIdProp,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; q?: string; activeOrgPublicId?: string; organizationPublicId?: string }>;
  /** When set (org workspace), active org hint for UI context. */
  activeOrgPublicId?: string;
}) {
  const { id: rawId } = await params;
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const q = typeof sp.q === "string" ? sp.q : "";
  const orgFromQuery =
    typeof sp.activeOrgPublicId === "string"
      ? sp.activeOrgPublicId.trim()
      : typeof sp.organizationPublicId === "string"
        ? sp.organizationPublicId.trim()
        : "";
  const orgFromCookie = (await getServerActiveOrganizationPublicId())?.trim() || "";
  const activeOrgPublicId =
    activeOrgPublicIdProp?.trim() || orgFromQuery || orgFromCookie || undefined;

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
      redirect("/resource-not-found");
    } else if (initialProject.publicId && safeProjectId !== initialProject.publicId) {
      const params = new URLSearchParams();
      if (page > 1) params.set("page", String(page));
      if (q.trim()) params.set("q", q);
      const qs = params.toString();
      const base = `/projects/${initialProject.publicId}`;
      redirect(qs ? `${base}?${qs}` : base);
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
      activeOrgPublicId={activeOrgPublicId}
    />
  );
}
