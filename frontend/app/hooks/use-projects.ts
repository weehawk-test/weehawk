import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateProjectInput, Project } from "@/lib/schema";
import {
  createProjectApi,
  deleteProjectApi,
  fetchProject,
  fetchProjects,
  updateProjectApi,
} from "@/lib/projects-api";

export function useProjects(initialData?: Project[]) {
  const hasInitial = initialData !== undefined;
  return useQuery({
    queryKey: ["projects"],
    queryFn: fetchProjects,
    initialData,
    initialDataUpdatedAt: hasInitial ? Date.now() : undefined,
    staleTime: hasInitial ? Infinity : 10_000,
    refetchOnMount: hasInitial ? false : true,
    refetchOnWindowFocus: false,
  });
}

export function useProject(id: string, options?: { initialData?: Project }) {
  const hasInitial = options?.initialData !== undefined;
  return useQuery({
    queryKey: ["projects", id],
    queryFn: () => fetchProject(id),
    enabled: !!id,
    initialData: options?.initialData,
    staleTime: hasInitial ? Infinity : 10_000,
    refetchOnMount: hasInitial ? false : undefined,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateProjectInput) => createProjectApi(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteProjectApi(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useToggleProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateProjectApi(id, { isActive }),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["projects", v.id] });
    },
  });
}
