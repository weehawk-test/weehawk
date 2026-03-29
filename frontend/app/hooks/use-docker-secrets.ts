import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateDockerSecretInput, ReplaceDockerSecretInput } from "@/lib/schema";
import {
  listDockerSecrets,
  createDockerSecretApi,
  deleteDockerSecretApi,
  replaceDockerSecretApi,
  bulkImportSecretsApi,
} from "@/lib/docker-secrets-api";

export function useDockerSecrets() {
  return useQuery({
    queryKey: ["docker-secrets"],
    queryFn: listDockerSecrets,
    staleTime: 15_000,
  });
}

export function useCreateDockerSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateDockerSecretInput) =>
      createDockerSecretApi({ name: data.name.trim(), value: data.value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["docker-secrets"] }),
  });
}

export function useDeleteDockerSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => deleteDockerSecretApi(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["docker-secrets"] }),
  });
}

export function useReplaceDockerSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, value }: ReplaceDockerSecretInput) =>
      replaceDockerSecretApi(name.trim(), value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["docker-secrets"] }),
  });
}

export function useBulkImportDockerSecrets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (envText: string) => bulkImportSecretsApi(envText),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["docker-secrets"] }),
  });
}
