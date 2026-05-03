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

export function useCronJobs() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ["cron-jobs", "personal"],
    queryFn: () => fetchCronJobs(accessToken!),
    select: (rows) =>
      reconcileAndFilterPendingDeletions("cron-jobs", rows, (item) => [item.id, item.publicId]),
    enabled: Boolean(accessToken),
  });
}

export function useCronJob(id: string | number) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ["cron-jobs", id],
    queryFn: () => fetchCronJob(accessToken!, id),
    enabled: Boolean(accessToken) && cronJobQueryEnabled(id),
  });
}

export function useCreateCronJob() {
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  return useMutation({
    mutationFn: (body: CreateCronJobBody) => createCronJob(accessToken!, body),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["cron-jobs", "personal"] });
      const org = vars.organizationPublicId?.trim();
      if (org) queryClient.invalidateQueries({ queryKey: ["cron-jobs", org] });
    },
  });
}

export function useUpdateCronJob(organizationPublicId?: string | null) {
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  const orgKey = organizationPublicId?.trim();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string | number } & UpdateCronJobBody) =>
      updateCronJob(accessToken!, id, body, organizationPublicId),
    onSuccess: (updated, v) => {
      queryClient.invalidateQueries({ queryKey: ["cron-jobs", "personal"] });
      if (orgKey) queryClient.invalidateQueries({ queryKey: ["cron-jobs", orgKey] });
      queryClient.invalidateQueries({ queryKey: ["cron-jobs", v.id] });
      queryClient.invalidateQueries({ queryKey: ["cron-jobs", cronJobRouteId(updated)] });
    },
  });
}

export function useDeleteCronJob(organizationPublicId?: string | null) {
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  const orgKey = organizationPublicId?.trim() || "personal";
  return useMutation({
    mutationFn: (id: string | number) =>
      deleteCronJob(accessToken!, id, organizationPublicId),
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
