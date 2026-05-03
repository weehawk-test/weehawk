import type { PaginatedSecretsResponse } from "@/lib/docker-paged-fetch";
import type { DockerSecretListItem } from "@/lib/schema";
import { reconcileAndFilterPendingDeletions } from "@/lib/pending-deletions";

/** Stable id for pending-deletions storage (server scoped; name is encoded). */
export function dockerSecretPendingId(remoteServerId: string | number, name: string): string {
  return `${String(remoteServerId)}:${encodeURIComponent(name.trim())}`;
}

/**
 * SSR / cookie: drop rows still marked pending-delete, and lower totals only by how many
 * rows were hidden on this page (avoids subtracting after the server already removed the secret).
 */
export function filterSecretsPageWithPendingSet(
  data: PaginatedSecretsResponse,
  pending: Set<string>,
  remoteServerId: string | number,
): PaginatedSecretsResponse {
  const items = data.items.filter((row) => !pending.has(dockerSecretPendingId(remoteServerId, row.name)));
  const removedHere = data.items.length - items.length;
  return {
    ...data,
    items,
    total: Math.max(0, data.total - removedHere),
    totalAll: Math.max(0, data.totalAll - removedHere),
  };
}

/** Client: prune stale pending ids, hide in-flight deletes, align totals for this page. */
export function reconcileSecretsPageWithPendingDeletions(
  data: PaginatedSecretsResponse,
  remoteServerId: string | number,
): PaginatedSecretsResponse {
  const before = data.items.length;
  const items = reconcileAndFilterPendingDeletions("docker-secrets", data.items, (row: DockerSecretListItem) => [
    dockerSecretPendingId(remoteServerId, row.name),
  ]);
  const removedHere = before - items.length;
  return {
    ...data,
    items,
    total: Math.max(0, data.total - removedHere),
    totalAll: Math.max(0, data.totalAll - removedHere),
  };
}
