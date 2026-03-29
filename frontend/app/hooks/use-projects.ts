import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateProjectInput } from "@/lib/schema";
import {
  createProjectApi,
  deleteProjectApi,
  fetchProject,
  fetchProjects,
  updateProjectApi,
} from "@/lib/projects-api";

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: fetchProjects,
    staleTime: 10_000,
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: ["projects", id],
    queryFn: () => fetchProject(id),
    enabled: !!id,
    staleTime: 10_000,
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
