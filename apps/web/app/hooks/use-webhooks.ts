import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import {
  type WebhookListItem,
  createWebhook,
  deleteWebhook,
  fetchWebhook,
  fetchWebhooks,
  updateWebhook,
  webhookRouteId,
  type CreateWebhookBody,
  type UpdateWebhookBody,
} from "@/lib/webhooks-api";
import {
  clearPendingDeletion,
  markPendingDeletion,
  reconcileAndFilterPendingDeletions,
} from "@/lib/pending-deletions";

function webhookQueryEnabled(id: string | number): boolean {
  return typeof id === "string" ? id.trim().length > 0 : Number.isFinite(id);
}

export function useWebhooks() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ["webhooks", "personal"],
    queryFn: () => fetchWebhooks(accessToken!),
    select: (rows) =>
      reconcileAndFilterPendingDeletions("webhooks", rows, (item) => [item.id, item.publicId]),
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
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["webhooks", "personal"] });
      const org = vars.organizationPublicId?.trim();
      if (org) queryClient.invalidateQueries({ queryKey: ["webhooks", org] });
    },
  });
}

export function useUpdateWebhook(organizationPublicId?: string | null) {
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  const orgKey = organizationPublicId?.trim();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string | number } & UpdateWebhookBody) =>
      updateWebhook(accessToken!, id, body, organizationPublicId),
    onSuccess: (updated, v) => {
      queryClient.invalidateQueries({ queryKey: ["webhooks", "personal"] });
      if (orgKey) queryClient.invalidateQueries({ queryKey: ["webhooks", orgKey] });
      queryClient.invalidateQueries({ queryKey: ["webhooks", v.id] });
      queryClient.invalidateQueries({ queryKey: ["webhooks", webhookRouteId(updated)] });
    },
  });
}

export function useDeleteWebhook(organizationPublicId?: string | null) {
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  const orgKey = organizationPublicId?.trim() || "personal";
  return useMutation({
    mutationFn: (id: string | number) =>
      deleteWebhook(accessToken!, id, organizationPublicId),
    onMutate: async (id) => {
      const matchId = String(id);
      const pendingIds = new Set<string>([matchId]);
      const previousWebhooks = queryClient.getQueryData<WebhookListItem[]>([
        "webhooks",
        orgKey,
      ]);
      if (Array.isArray(previousWebhooks)) {
        const filtered = previousWebhooks.filter((item) => {
          const matches = String(item.id) === matchId || String(item.publicId ?? "") === matchId;
          if (matches) {
            pendingIds.add(String(item.id));
            if (item.publicId) pendingIds.add(String(item.publicId));
          }
          return !matches;
        });
        queryClient.setQueryData(["webhooks", orgKey], filtered);
      }
      markPendingDeletion("webhooks", ...Array.from(pendingIds));
      return { previousWebhooks, pendingIds: Array.from(pendingIds) };
    },
    onError: (_error, _id, context) => {
      clearPendingDeletion("webhooks", ...(context?.pendingIds ?? []));
      if (context?.previousWebhooks) {
        queryClient.setQueryData(["webhooks", orgKey], context.previousWebhooks);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhooks", orgKey] });
    },
  });
}
