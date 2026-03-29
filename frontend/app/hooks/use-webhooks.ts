import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import {
  createWebhook,
  deleteWebhook,
  fetchWebhook,
  fetchWebhooks,
  updateWebhook,
  type CreateWebhookBody,
  type UpdateWebhookBody,
} from "@/lib/webhooks-api";

export function useWebhooks() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ["webhooks"],
    queryFn: () => fetchWebhooks(accessToken!),
    enabled: Boolean(accessToken),
  });
}

export function useWebhook(id: string) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ["webhooks", id],
    queryFn: () => fetchWebhook(accessToken!, id),
    enabled: Boolean(accessToken) && Boolean(id),
  });
}

export function useCreateWebhook() {
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  return useMutation({
    mutationFn: (body: CreateWebhookBody) => createWebhook(accessToken!, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
    },
  });
}

export function useUpdateWebhook() {
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & UpdateWebhookBody) =>
      updateWebhook(accessToken!, id, body),
    onSuccess: (_, v) => {
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      queryClient.invalidateQueries({ queryKey: ["webhooks", v.id] });
    },
  });
}

export function useDeleteWebhook() {
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  return useMutation({
    mutationFn: (id: string) => deleteWebhook(accessToken!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
    },
  });
}
