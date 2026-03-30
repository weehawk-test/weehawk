import ServiceDetailsClient from "./service-details-client";
import { fetchProject } from "@/lib/projects-api";
import { fetchService, fetchServiceRuntime } from "@/lib/services-api";
import { DOCKER_LIST_PAGE_SIZE } from "@/lib/docker-paged-fetch";
import type { PaginatedSecretsResponse } from "@/lib/docker-paged-fetch";
import type { Project, Service } from "@/lib/schema";
import { fetchDockerSecretsPaged } from "@/lib/docker-paged-fetch";

export default async function ServiceDetailsPage({
  params,
}: {
  params: Promise<{ id: string; serviceId: string }>;
}) {
  const { id: projectIdRaw, serviceId: serviceIdRaw } = await params;

  const projectIdParsed = Number(projectIdRaw);
  const serviceIdParsed = Number(serviceIdRaw);
  const safeProjectId = Number.isNaN(projectIdParsed) ? null : String(projectIdParsed);
  const safeServiceId = Number.isNaN(serviceIdParsed) ? null : String(serviceIdParsed);

  let initialProject: Project | null = null;
  let initialService: Service | null = null;
  let initialRuntime: { running: boolean } | null = null;
  let initialSecretsPaged: PaginatedSecretsResponse | null = null;

  if (safeProjectId) {
    try {
      initialProject = await fetchProject(safeProjectId);
    } catch {
      initialProject = null;
    }
  }

  if (safeServiceId) {
    try {
      initialService = await fetchService(safeServiceId);
    } catch {
      initialService = null;
    }

    try {
      initialRuntime = await fetchServiceRuntime(safeServiceId);
    } catch {
      initialRuntime = null;
    }

    try {
      initialSecretsPaged = await fetchDockerSecretsPaged(1, DOCKER_LIST_PAGE_SIZE, "");
    } catch {
      initialSecretsPaged = null;
    }
  }

  return (
    <ServiceDetailsClient
      initialProject={initialProject}
      initialService={initialService}
      initialRuntime={initialRuntime}
      initialSecretsPaged={initialSecretsPaged}
    />
  );
}

