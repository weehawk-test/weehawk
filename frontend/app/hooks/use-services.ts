import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateServiceInput, Service } from "@/lib/schema";
import {
  createServiceApi,
  deleteServiceApi,
  fetchService,
  fetchServiceRuntime,
  fetchServices,
  shutdownServiceApi,
  startServiceApi,
  updateServiceApi,
} from "@/lib/services-api";

export function useServices(projectId?: string) {
  return useQuery({
    queryKey: ["services", projectId],
    queryFn: () => fetchServices(projectId),
    enabled: projectId !== undefined && projectId !== "",
    staleTime: 10_000,
  });
}

export function useService(id: string) {
  return useQuery({
    queryKey: ["service", id],
    queryFn: () => fetchService(id),
    enabled: !!id,
    staleTime: 10_000,
  });
}

export function useServiceRuntime(id: string | undefined) {
  return useQuery({
    queryKey: ["service-runtime", id],
    queryFn: () => fetchServiceRuntime(id!),
    enabled: !!id,
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}

export function useCreateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateServiceInput) => createServiceApi(data),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["services", v.projectId] });
      qc.invalidateQueries({ queryKey: ["services"] });
      qc.invalidateQueries({ queryKey: ["projects", v.projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useUpdateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<Pick<Service, "config" | "env" | "isActive" | "description" | "domains">>;
    }) => updateServiceApi(id, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["services", data.projectId] });
      qc.invalidateQueries({ queryKey: ["services"] });
      qc.invalidateQueries({ queryKey: ["service", data.id] });
      qc.invalidateQueries({ queryKey: ["projects", data.projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useDeleteService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteServiceApi(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["services"] });
      qc.invalidateQueries({ queryKey: ["service", id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useShutdownService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => shutdownServiceApi(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["services"] });
      qc.invalidateQueries({ queryKey: ["service", id] });
      qc.invalidateQueries({ queryKey: ["service-runtime", id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useStartService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => startServiceApi(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["services"] });
      qc.invalidateQueries({ queryKey: ["service", id] });
      qc.invalidateQueries({ queryKey: ["service-runtime", id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useToggleService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateServiceApi(id, { isActive }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["services", data.projectId] });
      qc.invalidateQueries({ queryKey: ["services"] });
      qc.invalidateQueries({ queryKey: ["service", data.id] });
      qc.invalidateQueries({ queryKey: ["projects", data.projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
