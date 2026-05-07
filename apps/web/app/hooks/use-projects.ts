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

export function projectQueryKey(
  userId: number | undefined,
  projectId: string,
  activeOrgPublicId?: string | null,
) {
  return ["projects", userId ?? "none", projectId, activeOrgPublicId?.trim() ?? ""] as const;
}

export function useProjectsPage(
  page: number,
  q: string,
  ssrPage: number,
  ssrQ: string,
  initialPageData?: ProjectsPageResponse,
  activeOrgPublicId?: string,
  /** Must match active org id used when SSR fetched `initialPageData` (usually same current org). */
  initialPageOrganizationId?: string,
) {
  const { user } = useAuth();
  const ownerKey = user?.userId ?? "none";
  const trimmed = q.trim();
  const ssrTrim = ssrQ.trim();
  const orgKey = activeOrgPublicId?.trim() ?? "";
  const initialOrgKey = initialPageOrganizationId?.trim() ?? "";
  const hasSsrInitial =
    initialPageData !== undefined &&
    page === ssrPage &&
    trimmed === ssrTrim &&
    orgKey === initialOrgKey;

  return useQuery({
    queryKey: ["projects", "list", ownerKey, orgKey, page, trimmed],
    queryFn: () => fetchProjectsPage(page, undefined, trimmed),
    enabled: Boolean(user?.userId),
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
 * @param options.skipClientFetch — legacy flag; duplicate GET on mount is avoided via `initialData` + `staleTime` + `refetchOnMount`.
 */
export function useProject(
  id: string,
  options?: {
    initialData?: Project;
    skipClientFetch?: boolean;
    activeOrgPublicId?: string | null;
  },
) {
  const { user } = useAuth();
  const ownerKey = user?.userId ?? "none";
  const orgKey = options?.activeOrgPublicId?.trim() ?? "";
  const hasInitial = options?.initialData !== undefined;
  return useQuery({
    queryKey: projectQueryKey(user?.userId, id, orgKey || undefined),
    queryFn: () => fetchProject(id),
    /** Stay enabled with SSR `initialData` so org-realtime invalidation can refetch. */
    enabled: Boolean(id),
    initialData: options?.initialData,
    initialDataUpdatedAt: hasInitial ? Date.now() : undefined,
    staleTime: hasInitial ? Infinity : 10_000,
    refetchOnMount: !hasInitial,
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
    mutationFn: (args: { id: string; activeOrgPublicId?: string | null }) =>
      deleteProjectApi(args.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects", "list"], exact: false }),
  });
}
