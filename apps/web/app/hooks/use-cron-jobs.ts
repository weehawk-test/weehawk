import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import {
  createCronJob,
  deleteCronJob,
  fetchCronJob,
  fetchCronJobs,
  updateCronJob,
  type CreateCronJobBody,
  type UpdateCronJobBody,
} from "@/lib/cron-jobs-api";

export function useCronJobs() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ["cron-jobs"],
    queryFn: () => fetchCronJobs(accessToken!),
    enabled: Boolean(accessToken),
  });
}

export function useCronJob(id: number) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ["cron-jobs", id],
    queryFn: () => fetchCronJob(accessToken!, id),
    enabled: Boolean(accessToken) && Number.isFinite(id),
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
    mutationFn: ({ id, ...body }: { id: number } & UpdateCronJobBody) =>
      updateCronJob(accessToken!, id, body),
    onSuccess: (_, v) => {
      queryClient.invalidateQueries({ queryKey: ["cron-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["cron-jobs", v.id] });
    },
  });
}

export function useDeleteCronJob() {
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  return useMutation({
    mutationFn: (id: number) => deleteCronJob(accessToken!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cron-jobs"] });
    },
  });
}
