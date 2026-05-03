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
  organizationPublicId: organizationPublicIdProp,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; q?: string; organizationPublicId?: string }>;
  /** When set (org workspace), required by the API to load org-scoped projects. */
  organizationPublicId?: string;
}) {
  const { id: rawId } = await params;
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const q = typeof sp.q === "string" ? sp.q : "";
  const orgFromQuery =
    typeof sp.organizationPublicId === "string" ? sp.organizationPublicId.trim() : "";
  const orgFromCookie = (await getServerActiveOrganizationPublicId())?.trim() || "";
  const organizationPublicId =
    organizationPublicIdProp?.trim() || orgFromQuery || orgFromCookie || undefined;

  const safeProjectId = rawId.trim() ? rawId.trim() : null;

  let initialProject: Project | null = null;
  let initialServicesPage: ServicesPageResponse | undefined;
  let initialProjectError: string | null = null;

  if (safeProjectId) {
    const [projectResult, servicesResult] = await Promise.all([
      fetchProjectSSR(safeProjectId, organizationPublicId),
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
      if (organizationPublicId) {
        params.set("organizationPublicId", organizationPublicId);
      }
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
      organizationPublicId={organizationPublicId}
    />
  );
}
