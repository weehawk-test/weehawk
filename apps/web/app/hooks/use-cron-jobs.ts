import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import {
  createCronJob,
  cronJobRouteId,
  deleteCronJob,
  fetchCronJob,
  fetchCronJobs,
  updateCronJob,
  type CreateCronJobBody,
  type UpdateCronJobBody,
} from "@/lib/cron-jobs-api";

function cronJobQueryEnabled(id: string | number): boolean {
  return typeof id === "string" ? id.trim().length > 0 : Number.isFinite(id);
}

export function useCronJobs() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ["cron-jobs"],
    queryFn: () => fetchCronJobs(accessToken!),
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cron-jobs"] });
    },
  });
}

export function useUpdateCronJob() {
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string | number } & UpdateCronJobBody) =>
      updateCronJob(accessToken!, id, body),
    onSuccess: (updated, v) => {
      queryClient.invalidateQueries({ queryKey: ["cron-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["cron-jobs", v.id] });
      queryClient.invalidateQueries({ queryKey: ["cron-jobs", cronJobRouteId(updated)] });
    },
  });
}

export function useDeleteCronJob() {
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  return useMutation({
    mutationFn: (id: string | number) => deleteCronJob(accessToken!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cron-jobs"] });
    },
  });
}
