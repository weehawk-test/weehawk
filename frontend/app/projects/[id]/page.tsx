import ProjectsIdClient from "./ProjectsIdClient";
import { fetchProject } from "@/lib/projects-api";
import { fetchServices } from "@/lib/services-api";
import type { Project, Service } from "@/lib/schema";

export default async function ProjectDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const parsedId = Number(rawId);
  // Backend controller uses `+id` and expects a valid integer.
  // If `rawId` is not numeric for any reason, avoid calling the API with NaN.
  const safeProjectId = Number.isNaN(parsedId) ? null : String(parsedId);

  let initialProject: Project | null = null;
  let initialServices: Service[] = [];
  let initialProjectError: string | null = null;

  if (safeProjectId) {
    try {
      initialProject = await fetchProject(safeProjectId);
    } catch (e) {
      initialProject = null;
      initialProjectError = e instanceof Error ? e.message : "Failed to fetch project from API.";
    }

    try {
      initialServices = await fetchServices(safeProjectId);
    } catch {
      initialServices = [];
    }
  }

  return (
    <ProjectsIdClient
      projectId={safeProjectId ?? rawId}
      initialProject={initialProject}
      initialServices={initialServices}
      initialProjectError={initialProjectError}
    />
  );
}
