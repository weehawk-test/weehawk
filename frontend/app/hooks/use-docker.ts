import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchDockerContainers,
  fetchDockerImages,
  fetchDockerVolumes,
  fetchDockerStats,
  deleteDockerContainer,
  deleteDockerImage,
  deleteDockerVolume,
} from "@/lib/docker-api";

export function useDockerContainers() {
  return useQuery({
    queryKey: ["docker", "containers"],
    queryFn: fetchDockerContainers,
    staleTime: 15_000,
  });
}

export function useDeleteDockerContainer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (idOrName: string) => deleteDockerContainer(idOrName),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["docker", "containers"] }),
  });
}

export function useDockerImages() {
  return useQuery({
    queryKey: ["docker", "images"],
    queryFn: fetchDockerImages,
    staleTime: 15_000,
  });
}

export function useDeleteDockerImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ref: string) => deleteDockerImage(ref),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["docker", "images"] }),
  });
}

export function useDockerVolumes() {
  return useQuery({
    queryKey: ["docker", "volumes"],
    queryFn: fetchDockerVolumes,
    staleTime: 15_000,
  });
}

export function useDeleteDockerVolume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => deleteDockerVolume(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["docker", "volumes"] }),
  });
}

export function useDockerStats(options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: ["docker", "stats"],
    queryFn: fetchDockerStats,
    staleTime: 2000,
    refetchInterval: options?.refetchInterval ?? 3000,
  });
}
