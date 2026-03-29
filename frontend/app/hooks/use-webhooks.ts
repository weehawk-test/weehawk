import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Webhook, CreateWebhookInput, UpdateWebhookInput, webhookSchema } from "@/lib/schema";
import { z } from "zod";

const STORAGE_KEY = "webhook_manager_data";

// Helper to simulate network latency for a more realistic feel
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getStoredWebhooks = (): Webhook[] => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    const parsed = JSON.parse(data);
    return z.array(webhookSchema).parse(parsed);
  } catch (e) {
    console.error("Failed to parse webhooks from localStorage", e);
    return [];
  }
};

const saveWebhooks = (webhooks: Webhook[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(webhooks));
};

// --- HOOKS ---

export function useWebhooks() {
  return useQuery({
    queryKey: ["webhooks"],
    queryFn: async () => {
      await delay(300); // simulate network
      const webhooks = getStoredWebhooks();
      // Sort by creation date descending
      return webhooks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },
  });
}

export function useWebhook(id: string) {
  return useQuery({
    queryKey: ["webhooks", id],
    queryFn: async () => {
      await delay(200);
      const webhooks = getStoredWebhooks();
      const webhook = webhooks.find((w) => w.id === id);
      if (!webhook) throw new Error("Webhook not found");
      return webhook;
    },
    enabled: !!id,
  });
}

export function useCreateWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateWebhookInput) => {
      await delay(400);
      const webhooks = getStoredWebhooks();
      const newWebhook: Webhook = {
        ...data,
        description: data.description || "",
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        isActive: true,
      };
      saveWebhooks([...webhooks, newWebhook]);
      return newWebhook;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
    },
  });
}

export function useUpdateWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & UpdateWebhookInput) => {
      await delay(300);
      const webhooks = getStoredWebhooks();
      const index = webhooks.findIndex((w) => w.id === id);
      if (index === -1) throw new Error("Webhook not found");
      
      const updatedWebhook = { ...webhooks[index], ...updates };
      webhooks[index] = updatedWebhook;
      saveWebhooks(webhooks);
      return updatedWebhook;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      queryClient.invalidateQueries({ queryKey: ["webhooks", variables.id] });
    },
  });
}

export function useDeleteWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await delay(300);
      const webhooks = getStoredWebhooks();
      saveWebhooks(webhooks.filter((w) => w.id !== id));
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
    },
  });
}
