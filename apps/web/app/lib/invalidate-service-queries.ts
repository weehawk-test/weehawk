import type { QueryClient } from "@tanstack/react-query";

const SERVICE_ROOTS = ["service", "service-runtime", "service-volumes"] as const;

/**
 * useService / useServiceRuntime / useServiceVolumes use:
 * `["service" | "service-runtime" | "service-volumes", ownerKey, serviceId]`.
 * - Predicate-only invalidation can miss edge cases; use exact 3-part keys.
 * - After SSR, cache may live under `ownerKey === "none"` while the session user is real — invalidate both.
 * - With `staleTime: Infinity` + `initialData`, `refetchQueries` forces a network round-trip after deploy/start/stop.
 */
function ownerSegment(ownerKey: unknown): string | number {
  if (ownerKey == null || ownerKey === "") return "none";
  if (typeof ownerKey === "number" && Number.isFinite(ownerKey)) return ownerKey;
  if (typeof ownerKey === "string") {
    const t = ownerKey.trim();
    return t.length > 0 ? t : "none";
  }
  return "none";
}

export function invalidateServiceScopedQueries(
  qc: QueryClient,
  serviceId: string,
  ownerKey?: unknown,
) {
  const id = String(serviceId);
  const ok = ownerSegment(ownerKey);
  const ownerVariants = new Set<string | number>([ok]);
  if (ok !== "none") ownerVariants.add("none");

  const keys: unknown[][] = [];
  for (const root of SERVICE_ROOTS) {
    for (const v of ownerVariants) {
      keys.push([root, v, id]);
    }
  }

  return Promise.all(
    keys.flatMap((queryKey) => [
      qc.invalidateQueries({ queryKey, exact: true }),
      qc.refetchQueries({ queryKey, exact: true, type: "active" }),
    ]),
  );
}

/** Extra runtime-only refetches after deploy/start/stop — Docker often lags behind the API response. */
const RUNTIME_BURST_MS = [450, 1_200, 2_500, 4_500, 8_000] as const;

export function scheduleServiceRuntimeRefetchBurst(
  qc: QueryClient,
  serviceId: string,
  ownerKey?: unknown,
) {
  const id = String(serviceId);
  const ok = ownerSegment(ownerKey);
  const owners = new Set<string | number>([ok]);
  if (ok !== "none") owners.add("none");

  const ping = () =>
    Promise.all(
      [...owners].map((v) =>
        qc.refetchQueries({
          queryKey: ["service-runtime", v, id],
          exact: true,
          type: "active",
        }),
      ),
    );

  for (const ms of RUNTIME_BURST_MS) {
    globalThis.setTimeout(() => void ping(), ms);
  }
}

/** One-off service row refresh (e.g. lastDeployedAt) without hammering volumes. */
export function scheduleServiceRowRefetchBurst(qc: QueryClient, serviceId: string, ownerKey?: unknown) {
  const id = String(serviceId);
  const ok = ownerSegment(ownerKey);
  const owners = new Set<string | number>([ok]);
  if (ok !== "none") owners.add("none");

  const ping = () =>
    Promise.all(
      [...owners].map((v) =>
        qc.refetchQueries({
          queryKey: ["service", v, id],
          exact: true,
          type: "active",
        }),
      ),
    );

  globalThis.setTimeout(() => void ping(), 800);
  globalThis.setTimeout(() => void ping(), 3_500);
}

function projectIdFromServicesQueryKey(key: readonly unknown[]): string | null {
  if (key[0] !== "services") return null;
  if (key[1] === "list" && key.length >= 4) return String(key[3]);
  if (key.length >= 3) return String(key[2]);
  return null;
}

/** useServices: `["services", ownerKey, projectId]`; useServicesPage: `["services","list", ownerKey, projectId,...]`. */
export function invalidateProjectServicesQueries(qc: QueryClient, projectId: string) {
  const pid = String(projectId);
  return qc.invalidateQueries({
    predicate: (q) => {
      const id = projectIdFromServicesQueryKey(q.queryKey as unknown[]);
      return id === pid;
    },
  });
}

/** useProject: `["projects", ownerKey, id, organizationPublicId?]`. */
export function invalidateProjectDetailQueries(qc: QueryClient, projectId: string) {
  const pid = String(projectId);
  return qc.invalidateQueries({
    predicate: (q) =>
      Array.isArray(q.queryKey) &&
      q.queryKey[0] === "projects" &&
      q.queryKey[1] !== "list" &&
      String(q.queryKey[q.queryKey.length - 1]) === pid,
  });
}
