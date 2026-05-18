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
  fetchProjectRuntimeSnapshot,
  shutdownServiceApi,
  startServiceApi,
  updateServiceApi,
  patchApplicationEnvApi,
  patchApplicationNetworksApi,
  patchApplicationVolumesApi,
  type ServicesPageResponse,
} from "@/lib/services-api";
import {
  invalidateProjectDetailQueries,
  invalidateProjectServicesQueries,
  invalidateServiceScopedQueries,
  scheduleServiceRuntimeRefetchBurst,
} from "@/lib/invalidate-service-queries";
import { serviceQueryKeyId } from "@/lib/services-api";
import {
  clearPendingDeletion,
  markPendingDeletion,
  reconcileAndFilterPendingDeletions,
} from "@/lib/pending-deletions";

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
    select: (rows) =>
      reconcileAndFilterPendingDeletions("services", rows, (item) => [item.id, item.publicId]),
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

  // Keep SSR data on first paint even before auth context finishes hydration,
  // so refreshing the project page doesn't flash a client-side loading state.
  const useSsrData = hasSsrInitial;

  return useQuery({
    queryKey: ["services", "list", ownerKey, projectId, page, trimmed],
    queryFn: () => fetchServicesPage(projectId, page, trimmed),
    /**
     * Must stay enabled when SSR seeded `initialData`, otherwise `invalidateQueries` / org realtime
     * cannot refetch (disabled observers skip network). Duplicates on first paint are avoided via
     * `staleTime: Infinity` + `refetchOnMount: false` while SSR data is current.
     */
    enabled: projectId !== undefined && projectId !== "",
    // Pending-deletion filtering uses localStorage/cookies — must not run in `select` or SSR and
    // first client paint mismatch server HTML (hydration error). Apply in the page after mount.
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
  options?: { initialData?: { running: boolean }; refetchIntervalMs?: number | false },
) {
  const { user } = useAuth();
  const ownerKey = user?.userId ?? "none";
  const hasInitial = options?.initialData !== undefined;
  return useQuery({
    queryKey: ["service-runtime", ownerKey, id],
    queryFn: () => fetchServiceRuntime(id!),
    enabled: !!id,
    initialDataUpdatedAt: hasInitial ? 0 : undefined,
    staleTime: Infinity,
    refetchInterval: options?.refetchIntervalMs ?? false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnMount: hasInitial ? false : undefined,
    initialData: options?.initialData,
  });
}

export function useProjectRuntimeSnapshot(projectId: string | undefined, enabled: boolean) {
  const { user } = useAuth();
  const ownerKey = user?.userId ?? "none";
  return useQuery({
    queryKey: ["project-runtime", ownerKey, projectId],
    queryFn: () => fetchProjectRuntimeSnapshot(projectId!),
    enabled: Boolean(projectId) && enabled,
    staleTime: Infinity,
    refetchOnWindowFocus: "always",
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
      void invalidateProjectServicesQueries(qc, v.projectId);
      qc.invalidateQueries({ queryKey: ["services"] });
      void invalidateProjectDetailQueries(qc, v.projectId);
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
          | "buildOnLocalDockerHost"
          | "registryPushImage"
        >
      >;
    }) => updateServiceApi(id, patch),
    onSuccess: (data) => {
      const sid = serviceQueryKeyId(data);
      qc.setQueryData(["service", user?.userId ?? "none", sid], data);
      void invalidateProjectServicesQueries(qc, data.projectId);
      qc.invalidateQueries({ queryKey: ["services"] });
      void invalidateServiceScopedQueries(qc, sid, user?.userId ?? "none");
      void invalidateProjectDetailQueries(qc, data.projectId);
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function usePatchApplicationNetworks() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: ({
      id,
      external,
      stack,
      attachToWeehawkNetwork,
    }: {
      id: string;
      external: string[];
      stack: string[];
      attachToWeehawkNetwork?: boolean;
    }) => patchApplicationNetworksApi(id, { external, stack, attachToWeehawkNetwork }),
    onSuccess: (data) => {
      void invalidateProjectServicesQueries(qc, data.projectId);
      qc.invalidateQueries({ queryKey: ["services"] });
      void invalidateServiceScopedQueries(qc, serviceQueryKeyId(data), user?.userId ?? "none");
    },
  });
}

export function usePatchApplicationVolumes() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: ({
      id,
      volumes,
    }: {
      id: string;
      volumes: Array<{ source: string; target: string; readOnly?: boolean }>;
    }) => patchApplicationVolumesApi(id, { volumes }),
    onSuccess: (data) => {
      void invalidateProjectServicesQueries(qc, data.projectId);
      qc.invalidateQueries({ queryKey: ["services"] });
      void invalidateServiceScopedQueries(qc, serviceQueryKeyId(data), user?.userId ?? "none");
    },
  });
}

export function usePatchApplicationEnv() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: ({
      id,
      variables,
    }: {
      id: string;
      variables: Array<{ key: string; value: string }>;
    }) => patchApplicationEnvApi(id, { variables }),
    onSuccess: (data) => {
      void invalidateProjectServicesQueries(qc, data.projectId);
      qc.invalidateQueries({ queryKey: ["services"] });
      void invalidateServiceScopedQueries(qc, serviceQueryKeyId(data), user?.userId ?? "none");
    },
  });
}

export function useDeleteService() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (id: string) => deleteServiceApi(id),
    onMutate: async (id) => {
      const matchId = String(id);
      const pendingIds = new Set<string>([matchId]);
      const previousServicesQueries = qc.getQueriesData<ServicesPageResponse | Service[]>({
        queryKey: ["services"],
      });

      for (const [queryKey, cached] of previousServicesQueries) {
        if (Array.isArray(cached)) {
          qc.setQueryData<Service[]>(
            queryKey,
            cached.filter((item) => String(item.id) !== matchId && String(item.publicId ?? "") !== matchId),
          );
          continue;
        }
        if (cached && Array.isArray(cached.data)) {
          const removedCount = cached.data.filter(
            (item) => String(item.id) === matchId || String(item.publicId ?? "") === matchId,
          ).length;
          if (removedCount > 0) {
            qc.setQueryData<ServicesPageResponse>(queryKey, {
              ...cached,
              data: cached.data.filter(
                (item) => String(item.id) !== matchId && String(item.publicId ?? "") !== matchId,
              ),
              total: Math.max(0, cached.total - removedCount),
            });
          }
        }
      }

      const previousServiceQueries = qc.getQueriesData<Service>({ queryKey: ["service"] });
      for (const [queryKey, cached] of previousServiceQueries) {
        if (!cached) continue;
        if (String(cached.id) === matchId || String(cached.publicId ?? "") === matchId) {
          pendingIds.add(String(cached.id));
          if (cached.publicId) pendingIds.add(String(cached.publicId));
          qc.setQueryData(queryKey, null);
        }
      }

      markPendingDeletion("services", ...Array.from(pendingIds));
      return { previousServicesQueries, previousServiceQueries, pendingIds: Array.from(pendingIds) };
    },
    onError: (_error, _id, context) => {
      if (!context) return;
      clearPendingDeletion("services", ...(context.pendingIds ?? []));
      for (const [queryKey, data] of context.previousServicesQueries) {
        qc.setQueryData(queryKey, data);
      }
      for (const [queryKey, data] of context.previousServiceQueries) {
        qc.setQueryData(queryKey, data);
      }
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["services"] });
      void invalidateServiceScopedQueries(qc, String(id), user?.userId ?? "none");
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

function setServiceRuntimeCached(
  qc: ReturnType<typeof useQueryClient>,
  serviceId: string,
  ownerKey: string | number | undefined,
  running: boolean,
) {
  const sid = String(serviceId);
  const ok = ownerKey == null || ownerKey === "" ? "none" : ownerKey;
  const owners = new Set<string | number>([ok]);
  if (ok !== "none") owners.add("none");
  for (const v of owners) {
    qc.setQueryData(["service-runtime", v, sid], { running });
  }
}

export function useShutdownService() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (id: string) => shutdownServiceApi(id),
    onSuccess: (_, id) => {
      setServiceRuntimeCached(qc, String(id), user?.userId ?? "none", false);
      qc.invalidateQueries({ queryKey: ["services"] });
      void invalidateServiceScopedQueries(qc, String(id), user?.userId ?? "none");
      scheduleServiceRuntimeRefetchBurst(qc, String(id), user?.userId ?? "none");
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useStartService() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (id: string) => startServiceApi(id),
    onSuccess: (_, id) => {
      setServiceRuntimeCached(qc, String(id), user?.userId ?? "none", true);
      qc.invalidateQueries({ queryKey: ["services"] });
      void invalidateServiceScopedQueries(qc, String(id), user?.userId ?? "none");
      scheduleServiceRuntimeRefetchBurst(qc, String(id), user?.userId ?? "none");
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useToggleService() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateServiceApi(id, { isActive }),
    onSuccess: (data) => {
      void invalidateProjectServicesQueries(qc, data.projectId);
      qc.invalidateQueries({ queryKey: ["services"] });
      void invalidateServiceScopedQueries(qc, serviceQueryKeyId(data), user?.userId ?? "none");
      void invalidateProjectDetailQueries(qc, data.projectId);
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
