"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useDockerSecretsPaged } from "@/hooks/use-docker-secrets";
import { DockerSecretsClient } from "@/(platform)/secrets/secrets-client";

function ServiceSecretsTabInner({ remoteServerId }: { remoteServerId: number | null }) {
  const searchParams = useSearchParams();
  const urlPage = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const urlQ = searchParams.get("q") ?? "";
  const { data, isLoading, isError, error } = useDockerSecretsPaged(remoteServerId, urlPage, urlQ);

  if (remoteServerId == null || remoteServerId < 1) {
    return (
      <div className="glass-panel rounded-xl border border-border p-5 text-sm text-muted-foreground space-y-2">
        <p>Choose a deploy remote server on the Remote tab to list Swarm secrets for that host.</p>
        <p className="text-xs">Secrets are read over SSH on the server where stacks run, not on the Weehawk API machine.</p>
      </div>
    );
  }

  const listError = isError ? (error instanceof Error ? error.message : String(error)) : null;

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
        <Loader2 className="w-6 h-6 animate-spin" />
        <span className="text-sm">Loading secrets…</span>
      </div>
    );
  }

  return (
    <DockerSecretsClient
      remoteServerId={remoteServerId}
      data={data ?? null}
      error={listError}
      urlPage={urlPage}
      urlQ={urlQ}
    />
  );
}

function SecretsTabFallback() {
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
      <Loader2 className="w-6 h-6 animate-spin" />
      <span className="text-sm">Loading…</span>
    </div>
  );
}

/** Secrets list with URL pagination/search (aligned with `/secrets`). */
export function ServiceSecretsTab({ remoteServerId }: { remoteServerId: number | null }) {
  return (
    <Suspense fallback={<SecretsTabFallback />}>
      <ServiceSecretsTabInner remoteServerId={remoteServerId} />
    </Suspense>
  );
}
