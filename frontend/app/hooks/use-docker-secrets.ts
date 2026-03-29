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

export function useDockerSecrets() {
  return useQuery({
    queryKey: ["docker-secrets"],
    queryFn: listDockerSecrets,
    staleTime: 15_000,
  });
}

export function useDockerSecretsPaged(page: number, q: string) {
  return useQuery({
    queryKey: ["docker-secrets-paged", page, q],
    queryFn: () => fetchDockerSecretsPagedApi(page, DOCKER_LIST_PAGE_SIZE, q),
    staleTime: 15_000,
  });
}

export function useCreateDockerSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateDockerSecretInput) =>
      createDockerSecretApi({ name: data.name.trim(), value: data.value }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["docker-secrets"] });
      void qc.invalidateQueries({ queryKey: ["docker-secrets-paged"] });
    },
  });
}

export function useDeleteDockerSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => deleteDockerSecretApi(name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["docker-secrets"] });
      void qc.invalidateQueries({ queryKey: ["docker-secrets-paged"] });
    },
  });
}

export function useReplaceDockerSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, value }: ReplaceDockerSecretInput) =>
      replaceDockerSecretApi(name.trim(), value),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["docker-secrets"] });
      void qc.invalidateQueries({ queryKey: ["docker-secrets-paged"] });
    },
  });
}

export function useBulkImportDockerSecrets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (envText: string) => bulkImportSecretsApi(envText),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["docker-secrets"] });
      void qc.invalidateQueries({ queryKey: ["docker-secrets-paged"] });
    },
  });
}
