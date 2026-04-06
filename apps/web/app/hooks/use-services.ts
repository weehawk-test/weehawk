import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateServiceInput, Service } from "@/lib/schema";
import { useAuth } from "@/contexts/auth-context";
import {
  createServiceApi,
  deleteServiceApi,
  fetchService,
  fetchServiceRuntime,
  fetchServiceVolumesApi,
  fetchServices,
  fetchServicesPage,
  shutdownServiceApi,
  startServiceApi,
  updateServiceApi,
  patchApplicationNetworksApi,
  type ServicesPageResponse,
} from "@/lib/services-api";

/** All services in project (`all=1`); use when the full list is required. */
export function useServices(
  projectId?: string,
  options?: { initialData?: Service[] },
) {
  const { user } = useAuth();
  const ownerKey = user?.userId ?? "none";
  const hasInitial = options?.initialData !== undefined;
  return useQuery({
    queryKey: ["services", ownerKey, projectId],
    queryFn: () => fetchServices(projectId),
    enabled: projectId !== undefined && projectId !== "",
    initialData: options?.initialData,
    staleTime: hasInitial ? Infinity : 10_000,
    refetchOnMount: hasInitial ? false : undefined,
  });
}

export function useServicesPage(
  projectId: string,
  page: number,
  q: string,
  ssrPage: number,
  ssrQ: string,
  initialPageData?: ServicesPageResponse,
) {
  const { user } = useAuth();
  const ownerKey = user?.userId ?? "none";
  const trimmed = q.trim();
  const ssrTrim = ssrQ.trim();
  const hasSsrInitial =
    initialPageData !== undefined &&
    page === ssrPage &&
    trimmed === ssrTrim;

  const useSsrData = hasSsrInitial && user?.userId != null;

  return useQuery({
    queryKey: ["services", "list", ownerKey, projectId, page, trimmed],
    queryFn: () => fetchServicesPage(projectId, page, trimmed),
    /** When SSR supplied this page/search, skip client GET /api/services (no duplicate in Network). */
    enabled: projectId !== undefined && projectId !== "" && !useSsrData,
    initialData: useSsrData ? initialPageData : undefined,
    initialDataUpdatedAt: useSsrData ? Date.now() : undefined,
    staleTime: useSsrData ? Infinity : 10_000,
    refetchOnMount: useSsrData ? false : true,
    refetchOnWindowFocus: false,
  });
}

export function useService(id: string, options?: { initialData?: Service }) {
  const { user } = useAuth();
  const ownerKey = user?.userId ?? "none";
  const hasInitial = options?.initialData !== undefined;
  return useQuery({
    queryKey: ["service", ownerKey, id],
    queryFn: () => fetchService(id),
    enabled: !!id,
    initialData: options?.initialData,
    initialDataUpdatedAt: hasInitial ? 0 : undefined,
    staleTime: hasInitial ? Infinity : 10_000,
    refetchOnMount: hasInitial ? false : undefined,
  });
}

export function useServiceRuntime(
  id: string | undefined,
  options?: { initialData?: { running: boolean } },
) {
  const { user } = useAuth();
  const ownerKey = user?.userId ?? "none";
  const hasInitial = options?.initialData !== undefined;
  return useQuery({
    queryKey: ["service-runtime", ownerKey, id],
    queryFn: () => fetchServiceRuntime(id!),
    enabled: !!id,
    initialDataUpdatedAt: hasInitial ? 0 : undefined,
    staleTime: hasInitial ? Infinity : 5_000,
    refetchInterval: hasInitial ? false : 10_000,
    refetchOnMount: hasInitial ? false : undefined,
    initialData: options?.initialData,
  });
}

export function useServiceVolumes(serviceId: string | undefined, enabled: boolean) {
  const { user } = useAuth();
  const ownerKey = user?.userId ?? "none";
  return useQuery({
    queryKey: ["service-volumes", ownerKey, serviceId],
    queryFn: () => fetchServiceVolumesApi(serviceId!),
    enabled: !!serviceId && enabled,
    staleTime: 15_000,
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
  const { user } = useAuth();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<
        Pick<
          Service,
          | "config"
          | "env"
          | "isActive"
          | "description"
          | "domains"
          | "traefikRoutes"
          | "remoteServerId"
          | "buildRemoteServerId"
          | "registryPushImage"
        >
      >;
    }) => updateServiceApi(id, patch),
    onSuccess: (data) => {
      // Keep ["service", id] in sync immediately so UI (e.g. remote host selects) does not revert
      // after navigation; invalidate alone can race or be skipped with staleTime: Infinity + no refetchOnMount.
      qc.setQueryData(["service", user?.userId ?? "none", String(data.id)], data);
      qc.invalidateQueries({ queryKey: ["services", data.projectId] });
      qc.invalidateQueries({ queryKey: ["services"] });
      qc.invalidateQueries({ queryKey: ["service", data.id] });
      qc.invalidateQueries({ queryKey: ["service-volumes", String(data.id)] });
      qc.invalidateQueries({ queryKey: ["projects", data.projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function usePatchApplicationNetworks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      external,
      stack,
    }: {
      id: string;
      external: string[];
      stack: string[];
    }) => patchApplicationNetworksApi(id, { external, stack }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["services", data.projectId] });
      qc.invalidateQueries({ queryKey: ["services"] });
      qc.invalidateQueries({ queryKey: ["service", data.id] });
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
