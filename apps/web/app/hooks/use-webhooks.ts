import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import {
  createWebhook,
  deleteWebhook,
  fetchWebhook,
  fetchWebhooks,
  updateWebhook,
  webhookRouteId,
  type CreateWebhookBody,
  type UpdateWebhookBody,
} from "@/lib/webhooks-api";

function webhookQueryEnabled(id: string | number): boolean {
  return typeof id === "string" ? id.trim().length > 0 : Number.isFinite(id);
}

export function useWebhooks() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ["webhooks"],
    queryFn: () => fetchWebhooks(accessToken!),
    enabled: Boolean(accessToken),
  });
}

export function useWebhook(id: string | number) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ["webhooks", id],
    queryFn: () => fetchWebhook(accessToken!, id),
    enabled: Boolean(accessToken) && webhookQueryEnabled(id),
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
    mutationFn: ({ id, ...body }: { id: string | number } & UpdateWebhookBody) =>
      updateWebhook(accessToken!, id, body),
    onSuccess: (updated, v) => {
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      queryClient.invalidateQueries({ queryKey: ["webhooks", v.id] });
      queryClient.invalidateQueries({ queryKey: ["webhooks", webhookRouteId(updated)] });
    },
  });
}

export function useDeleteWebhook() {
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  return useMutation({
    mutationFn: (id: string | number) => deleteWebhook(accessToken!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
    },
  });
}
