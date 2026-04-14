import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateDockerSecretInput, ReplaceDockerSecretInput } from "@/lib/schema";
import {
  listDockerSecrets,
  createDockerSecretApi,
  deleteDockerSecretApi,
  replaceDockerSecretApi,
  bulkImportSecretsApi,
  fetchDockerSecretsPagedApi,
} from "@/lib/docker-secrets-api";
import { DOCKER_LIST_PAGE_SIZE } from "@/lib/docker-paged-fetch";

export function useDockerSecrets(remoteServerId: number | null) {
  return useQuery({
    queryKey: ["docker-secrets", remoteServerId],
    queryFn: () => listDockerSecrets(remoteServerId!),
    staleTime: 15_000,
    enabled: remoteServerId != null && remoteServerId > 0,
  });
}

export function useDockerSecretsPaged(remoteServerId: number | null, page: number, q: string) {
  return useDockerSecretsPagedWithInitial(remoteServerId, page, q);
}

function useDockerSecretsPagedWithInitial(
  remoteServerId: number | null,
  page: number,
  q: string,
  options?: {
    initialData?: import("@/lib/docker-paged-fetch").PaginatedSecretsResponse;
    enabled?: boolean;
  },
) {
  const hasInitial = options?.initialData !== undefined;
  const enabled =
    (options?.enabled ?? true) && remoteServerId != null && remoteServerId > 0;
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
  remoteServerId: number | null,
  page: number,
  q: string,
  options?: {
    initialData?: import("@/lib/docker-paged-fetch").PaginatedSecretsResponse;
    enabled?: boolean;
  },
) {
  return useDockerSecretsPagedWithInitial(remoteServerId, page, q, options);
}

export function useCreateDockerSecret(remoteServerId: number | null) {
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

export function useDeleteDockerSecret(remoteServerId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => {
      if (remoteServerId == null) throw new Error("remoteServerId is required");
      return deleteDockerSecretApi(remoteServerId, name);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["docker-secrets"] });
      void qc.invalidateQueries({ queryKey: ["docker-secrets-paged"] });
    },
  });
}

export function useReplaceDockerSecret(remoteServerId: number | null) {
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

export function useBulkImportDockerSecrets(remoteServerId: number | null) {
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
