import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import {
  type CronJobListItem,
  createCronJob,
  cronJobRouteId,
  deleteCronJob,
  fetchCronJob,
  fetchCronJobs,
  updateCronJob,
  type CreateCronJobBody,
  type UpdateCronJobBody,
} from "@/lib/cron-jobs-api";
import {
  clearPendingDeletion,
  markPendingDeletion,
  reconcileAndFilterPendingDeletions,
} from "@/lib/pending-deletions";

function cronJobQueryEnabled(id: string | number): boolean {
  return typeof id === "string" ? id.trim().length > 0 : Number.isFinite(id);
}

export function useCronJobs(
  activeOrgPublicId: string | null | undefined,
  options?: { initialData?: CronJobListItem[] },
) {
  const { accessToken } = useAuth();
  const orgKey = activeOrgPublicId?.trim() ?? "";
  return useQuery({
    queryKey: ["cron-jobs", orgKey],
    queryFn: () => fetchCronJobs(accessToken!),
    select: (rows) =>
      reconcileAndFilterPendingDeletions("cron-jobs", rows, (item) => [item.id, item.publicId]),
    enabled: Boolean(accessToken) && Boolean(orgKey),
    ...(options?.initialData !== undefined ? { initialData: options.initialData } : {}),
  });
}

export function useCronJob(id: string | number, activeOrgPublicId: string | null | undefined) {
  const { accessToken } = useAuth();
  const orgKey = activeOrgPublicId?.trim() ?? "";
  return useQuery({
    queryKey: ["cron-jobs", orgKey, id],
    queryFn: () => fetchCronJob(accessToken!, id),
    enabled: Boolean(accessToken) && cronJobQueryEnabled(id) && Boolean(orgKey),
  });
}

export function useCreateCronJob() {
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  return useMutation({
    mutationFn: (body: CreateCronJobBody) => createCronJob(accessToken!, body),
    onSuccess: (_data, vars) => {
      const org = vars.organizationPublicId?.trim();
      if (org) queryClient.invalidateQueries({ queryKey: ["cron-jobs", org] });
    },
  });
}

export function useUpdateCronJob(activeOrgPublicId?: string | null) {
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  const orgKey = activeOrgPublicId?.trim() ?? "";
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string | number } & UpdateCronJobBody) =>
      updateCronJob(accessToken!, id, body),
    onSuccess: (updated, v) => {
      if (orgKey) queryClient.invalidateQueries({ queryKey: ["cron-jobs", orgKey] });
      queryClient.invalidateQueries({ queryKey: ["cron-jobs", orgKey, v.id] });
      queryClient.invalidateQueries({ queryKey: ["cron-jobs", cronJobRouteId(updated)] });
    },
  });
}

export function useDeleteCronJob(activeOrgPublicId?: string | null) {
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  const orgKey = activeOrgPublicId?.trim() ?? "";
  return useMutation({
    mutationFn: (id: string | number) => {
      if (!orgKey) throw new Error("activeOrgPublicId is required");
      return deleteCronJob(accessToken!, id);
    },
    onMutate: async (id) => {
      const matchId = String(id);
      const pendingIds = new Set<string>([matchId]);
      const previousCronJobs = queryClient.getQueryData<CronJobListItem[]>([
        "cron-jobs",
        orgKey,
      ]);
      if (Array.isArray(previousCronJobs)) {
        const filtered = previousCronJobs.filter((item) => {
          const matches = String(item.id) === matchId || String(item.publicId ?? "") === matchId;
          if (matches) {
            pendingIds.add(String(item.id));
            if (item.publicId) pendingIds.add(String(item.publicId));
          }
          return !matches;
        });
        queryClient.setQueryData(["cron-jobs", orgKey], filtered);
      }
      markPendingDeletion("cron-jobs", ...Array.from(pendingIds));
      return { previousCronJobs, pendingIds: Array.from(pendingIds) };
    },
    onError: (_error, _id, context) => {
      clearPendingDeletion("cron-jobs", ...(context?.pendingIds ?? []));
      if (context?.previousCronJobs) {
        queryClient.setQueryData(["cron-jobs", orgKey], context.previousCronJobs);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cron-jobs", orgKey] });
    },
  });
}
