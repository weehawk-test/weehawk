import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateDockerSecretInput, ReplaceDockerSecretInput } from "@/lib/schema";
import {
  listDockerSecrets,
  createDockerSecretApi,
  deleteDockerSecretApi,
  replaceDockerSecretApi,
  bulkImportSecretsApi,
  fetchDockerSecretsPagedApi,
  type DockerSecretsRemoteServerId,
} from "@/lib/docker-secrets-api";
import { DOCKER_LIST_PAGE_SIZE } from "@/lib/docker-paged-fetch";
import { clearPendingDeletion, markPendingDeletion } from "@/lib/pending-deletions";
import { dockerSecretPendingId } from "@/lib/docker-secrets-pending";

function secretsRemoteEnabled(id: DockerSecretsRemoteServerId | null): id is DockerSecretsRemoteServerId {
  if (id == null) return false;
  if (typeof id === "number") return Number.isFinite(id) && id > 0;
  return id.trim().length > 0;
}

export function useDockerSecrets(remoteServerId: DockerSecretsRemoteServerId | null) {
  return useQuery({
    queryKey: ["docker-secrets", remoteServerId],
    queryFn: () => listDockerSecrets(remoteServerId!),
    staleTime: 15_000,
    enabled: secretsRemoteEnabled(remoteServerId),
  });
}

export function useDockerSecretsPaged(
  remoteServerId: DockerSecretsRemoteServerId | null,
  page: number,
  q: string,
) {
  return useDockerSecretsPagedWithInitial(remoteServerId, page, q);
}

function useDockerSecretsPagedWithInitial(
  remoteServerId: DockerSecretsRemoteServerId | null,
  page: number,
  q: string,
  options?: {
    initialData?: import("@/lib/docker-paged-fetch").PaginatedSecretsResponse;
    enabled?: boolean;
  },
) {
  const hasInitial = options?.initialData !== undefined;
  const enabled = (options?.enabled ?? true) && secretsRemoteEnabled(remoteServerId);
  return useQuery({
    queryKey: ["docker-secrets-paged", remoteServerId, page, q],
    queryFn: () =>
      fetchDockerSecretsPagedApi(remoteServerId!, page, DOCKER_LIST_PAGE_SIZE, q),
    initialData: options?.initialData,
    initialDataUpdatedAt: hasInitial ? 0 : undefined,
    staleTime: hasInitial ? Infinity : 15_000,
    refetchOnMount: hasInitial ? false : undefined,
    enabled,
  });
}

export function useDockerSecretsPagedWithInitialData(
  remoteServerId: DockerSecretsRemoteServerId | null,
  page: number,
  q: string,
  options?: {
    initialData?: import("@/lib/docker-paged-fetch").PaginatedSecretsResponse;
    enabled?: boolean;
  },
) {
  return useDockerSecretsPagedWithInitial(remoteServerId, page, q, options);
}

export function useCreateDockerSecret(remoteServerId: DockerSecretsRemoteServerId | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateDockerSecretInput) => {
      if (remoteServerId == null) throw new Error("remoteServerId is required");
      return createDockerSecretApi({
        remoteServerId,
        name: data.name.trim(),
        value: data.value,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["docker-secrets"] });
      void qc.invalidateQueries({ queryKey: ["docker-secrets-paged"] });
    },
  });
}

export function useDeleteDockerSecret(remoteServerId: DockerSecretsRemoteServerId | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => {
      if (remoteServerId == null) throw new Error("remoteServerId is required");
      return deleteDockerSecretApi(remoteServerId, name);
    },
    onMutate: (name) => {
      if (remoteServerId == null) return {};
      const pendingId = dockerSecretPendingId(remoteServerId, name);
      markPendingDeletion("docker-secrets", pendingId);
      return { pendingId };
    },
    onError: (_err, _name, ctx) => {
      if (ctx?.pendingId) clearPendingDeletion("docker-secrets", ctx.pendingId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["docker-secrets"] });
      void qc.invalidateQueries({ queryKey: ["docker-secrets-paged"] });
    },
  });
}

export function useReplaceDockerSecret(remoteServerId: DockerSecretsRemoteServerId | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, value }: ReplaceDockerSecretInput) => {
      if (remoteServerId == null) throw new Error("remoteServerId is required");
      return replaceDockerSecretApi(remoteServerId, name.trim(), value);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["docker-secrets"] });
      void qc.invalidateQueries({ queryKey: ["docker-secrets-paged"] });
    },
  });
}

export function useBulkImportDockerSecrets(remoteServerId: DockerSecretsRemoteServerId | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (envText: string) => {
      if (remoteServerId == null) throw new Error("remoteServerId is required");
      return bulkImportSecretsApi(remoteServerId, envText);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["docker-secrets"] });
      void qc.invalidateQueries({ queryKey: ["docker-secrets-paged"] });
    },
  });
}
