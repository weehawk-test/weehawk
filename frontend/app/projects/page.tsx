import ProjectsClient from "./ProjectsClient";

import { fetchProjects } from "@/lib/projects-api";
import type { Project } from "@/lib/schema";

export default async function ProjectsPage() {
  let initialProjects: Project[] = [];
  let initialError: string | null = null;

  try {
    initialProjects = await fetchProjects();
  } catch (e) {
    initialError = e instanceof Error ? e.message : "Unknown error";
  }

  return <ProjectsClient projects={initialProjects} initialError={initialError} />;
}
