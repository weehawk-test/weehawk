import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateProjectInput, Project } from "@/lib/schema";
import { useAuth } from "@/contexts/auth-context";
import {
  createProjectApi,
  deleteProjectApi,
  fetchProject,
  fetchProjectsPage,
  type ProjectsPageResponse,
} from "@/lib/projects-api";

export function useProjectsPage(
  page: number,
  q: string,
  ssrPage: number,
  ssrQ: string,
  initialPageData?: ProjectsPageResponse,
  organizationPublicId?: string,
  /** Must match `organizationPublicId` used when SSR fetched `initialPageData` (usually same as current org id). */
  initialPageOrganizationId?: string,
) {
  const { user } = useAuth();
  const ownerKey = user?.userId ?? "none";
  const trimmed = q.trim();
  const ssrTrim = ssrQ.trim();
  const orgKey = organizationPublicId?.trim() ?? "";
  const initialOrgKey = initialPageOrganizationId?.trim() ?? "";
  const hasSsrInitial =
    initialPageData !== undefined &&
    page === ssrPage &&
    trimmed === ssrTrim &&
    orgKey === initialOrgKey;

  return useQuery({
    queryKey: ["projects", "list", ownerKey, orgKey, page, trimmed],
    queryFn: () => fetchProjectsPage(page, undefined, trimmed, organizationPublicId),
    initialData:
      hasSsrInitial && user?.userId != null ? initialPageData : undefined,
    initialDataUpdatedAt:
      hasSsrInitial && user?.userId != null ? Date.now() : undefined,
    staleTime: hasSsrInitial && user?.userId != null ? Infinity : 10_000,
    refetchOnMount: hasSsrInitial && user?.userId != null ? false : true,
    refetchOnWindowFocus: false,
  });
}

/**
 * @param options.skipClientFetch — when true (SSR already provided `initialData`), the browser never calls GET /projects/:id (avoids exposing full API JSON in DevTools Network).
 */
export function useProject(
  id: string,
  options?: { initialData?: Project; skipClientFetch?: boolean },
) {
  const { user } = useAuth();
  const ownerKey = user?.userId ?? "none";
  const skip = options?.skipClientFetch === true;
  const hasInitial = options?.initialData !== undefined;
  return useQuery({
    queryKey: ["projects", ownerKey, id],
    queryFn: () => fetchProject(id),
    enabled: !!id && !skip,
    initialData: options?.initialData,
    initialDataUpdatedAt: hasInitial ? Date.now() : undefined,
    staleTime: hasInitial ? Infinity : 10_000,
    refetchOnMount: skip || hasInitial ? false : true,
    refetchOnWindowFocus: false,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateProjectInput) => createProjectApi(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects", "list"], exact: false }),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteProjectApi(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects", "list"], exact: false }),
  });
}
