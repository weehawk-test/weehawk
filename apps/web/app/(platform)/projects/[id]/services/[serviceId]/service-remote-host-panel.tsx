"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Server } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { fetchRemoteServers } from "@/lib/remote-servers-api";
import type { Service } from "@/lib/schema";
import { useUpdateService } from "@/hooks/use-services";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { isCloudEdition } from "@/lib/weehawk-edition";
import { parseApplicationDeployMode } from "@/lib/env-utils";

/** Select value: build with the API host’s local Docker daemon (not SSH). */
const BUILD_ON_API_VALUE = "__local_api__";

export function ServiceRemoteHostPanel({ service }: { service: Service }) {
  const cloud = isCloudEdition();
  const { accessToken, user } = useAuth();
  const ownerKey = user?.userId;
  const { toast } = useToast();
  const updateService = useUpdateService();
  const isApplication = service.type === "application";

  /** Pre-built image deploy skips `docker build`; build host is ignored by the server. */
  const isPrebuiltImageMode = useMemo(
    () => parseApplicationDeployMode(service.config ?? "") === "image",
    [service.config],
  );

  const q = useQuery({
    queryKey: ["remote-servers", ownerKey],
    queryFn: () => fetchRemoteServers(accessToken ?? ""),
    enabled: Boolean(accessToken) && ownerKey != null,
  });

  const [value, setValue] = useState<string>(() =>
    service.remoteServerId != null ? String(service.remoteServerId) : "",
  );

  const [buildValue, setBuildValue] = useState<string>(() =>
    service.buildOnLocalDockerHost
      ? BUILD_ON_API_VALUE
      : service.buildRemoteServerId != null
        ? String(service.buildRemoteServerId)
        : "",
  );

  const [registryValue, setRegistryValue] = useState<string>(() => service.registryPushImage ?? "");

  const currentId = service.remoteServerId ?? null;
  const currentBuildId = service.buildRemoteServerId ?? null;
  const currentBuildOnApi = service.buildOnLocalDockerHost ?? false;

  useEffect(() => {
    setValue(currentId != null ? String(currentId) : "");
  }, [currentId]);

  useEffect(() => {
    setBuildValue(
      currentBuildOnApi
        ? BUILD_ON_API_VALUE
        : currentBuildId != null
          ? String(currentBuildId)
          : "",
    );
  }, [currentBuildId, currentBuildOnApi]);

  useEffect(() => {
    setRegistryValue(service.registryPushImage ?? "");
  }, [service.registryPushImage]);

  const deployOptions = useMemo(
    () => (q.data ?? []).filter((r) => r.serverRole === "deploy"),
    [q.data],
  );
  const buildOptions = useMemo(
    () => (q.data ?? []).filter((r) => r.serverRole === "build"),
    [q.data],
  );

  /** Build and deploy use different Docker daemons → image must go through a registry (push/pull). */
  const showRegistryImageField = useMemo(() => {
    if (!isApplication) return false;
    if (isPrebuiltImageMode) return false;
    const deployId = value === "" ? null : Number(value);
    if (deployId === null) return false;
    const buildOnApi = buildValue === BUILD_ON_API_VALUE;
    const effectiveBuildId = buildOnApi
      ? null
      : buildValue === ""
        ? deployId
        : Number.isFinite(Number(buildValue))
          ? Number(buildValue)
          : null;
    return buildOnApi || effectiveBuildId !== deployId;
  }, [isApplication, isPrebuiltImageMode, value, buildValue]);

  const deployDirty =
    (value === "" && currentId !== null) || (value !== "" && Number(value) !== currentId);
  const desiredBuildOnApi = buildValue === BUILD_ON_API_VALUE;
  const desiredDedicatedBuildId =
    desiredBuildOnApi || buildValue === ""
      ? null
      : Number.isFinite(Number(buildValue))
        ? Number(buildValue)
        : null;
  const buildDirty =
    isApplication &&
    !isPrebuiltImageMode &&
    (desiredBuildOnApi !== currentBuildOnApi ||
      (!desiredBuildOnApi && desiredDedicatedBuildId !== currentBuildId));
  const currentRegistry = (service.registryPushImage ?? "").trim();
  const registryDirty =
    showRegistryImageField && registryValue.trim() !== currentRegistry;
  /** Saved registry ref no longer needed (same build/deploy daemon) — offer Save to clear it. */
  const staleRegistryWhenMerged =
    isApplication &&
    !isPrebuiltImageMode &&
    !showRegistryImageField &&
    currentRegistry !== "";
  const dirty =
    deployDirty || buildDirty || registryDirty || staleRegistryWhenMerged;

  const save = () => {
    if (cloud && value === "") {
      toast({
        title: "Remote host required",
        description: "In Weehawk Cloud, choose a deploy host from your SSH-connected servers.",
        variant: "destructive",
      });
      return;
    }
    if (showRegistryImageField && registryValue.trim() === "") {
      toast({
        title: "Image name required",
        description: "Enter the full name (e.g. ghcr.io/you/app:latest). Sign in under Registry on this server first.",
        variant: "destructive",
      });
      return;
    }
    const patch: {
      remoteServerId?: number | null;
      buildRemoteServerId?: number | null;
      buildOnLocalDockerHost?: boolean;
      registryPushImage?: string | null;
    } = {};
    if (deployDirty) {
      patch.remoteServerId =
        value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
    }
    if (buildDirty) {
      if (buildValue === BUILD_ON_API_VALUE) {
        patch.buildOnLocalDockerHost = true;
        patch.buildRemoteServerId = null;
      } else {
        patch.buildOnLocalDockerHost = false;
        patch.buildRemoteServerId =
          buildValue === ""
            ? null
            : Number.isFinite(Number(buildValue))
              ? Number(buildValue)
              : null;
      }
    }
    if (registryDirty) {
      const t = registryValue.trim();
      patch.registryPushImage = t === "" ? null : t;
    }
    if (staleRegistryWhenMerged) {
      patch.registryPushImage = null;
    }
    updateService.mutate(
      { id: service.id, patch },
      {
        onSuccess: () => {
          toast({
            title: "Saved",
            description: "Host choices updated for this service.",
          });
        },
        onError: (e: Error) =>
          toast({ title: "Could not save", description: e.message, variant: "destructive" }),
      },
    );
  };

  if (!accessToken) {
    return null;
  }

  return (
    <div className="glass-panel rounded-2xl overflow-hidden border border-white/5">
      <div className="px-5 py-3.5 border-b border-white/5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0 flex gap-3">
          <div className="rounded-lg bg-primary/10 border border-primary/20 p-2 h-fit">
            <Server className="size-4 text-primary shrink-0" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Remote Docker host</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-md leading-relaxed">
              Choose hosts below, then <strong>Save</strong>. Add machines in{" "}
              <Link href="/remote-server" className="text-primary hover:underline">
                Remote servers
              </Link>
              . If build and run use different machines, sign in on{" "}
              <Link href="/registry" className="text-primary hover:underline">
                Registry
              </Link>{" "}
              (this server) and fill the image name when it appears.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={!dirty || updateService.isPending}
            onClick={() => save()}
            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 disabled:opacity-40 disabled:pointer-events-none"
          >
            {updateService.isPending ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
          </button>
        </div>
      </div>
      <div className="px-5 py-4 space-y-4">
        {q.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading remote hosts…
          </div>
        ) : q.isError ? (
          <p className="text-sm text-red-300">{(q.error as Error).message}</p>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 max-w-xl">
              <label className="text-xs text-muted-foreground shrink-0 sm:w-32">Deploy host</label>
              <select
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="flex-1 min-w-0 rounded-lg border border-border bg-muted dark:bg-black/40 px-3 py-2 text-sm text-foreground outline-none focus:border-primary/40"
              >
                {!cloud ? (
                  <option value="">This server (local Docker)</option>
                ) : deployOptions.length === 0 ? (
                  <option value="" disabled>
                    Add a remote host first (Remote servers)
                  </option>
                ) : (
                  <option value="" disabled>
                    Select remote deploy host…
                  </option>
                )}
                {deployOptions.map((r) => (
                  <option key={r.id} value={String(r.id)}>
                    {r.name} — {r.sshUser}@{r.host}
                    {r.port !== 22 ? `:${r.port}` : ""}
                  </option>
                ))}
              </select>
            </div>
            {isApplication ? (
              <div className="flex flex-col sm:flex-row sm:items-start gap-3 max-w-xl">
                <label className="text-xs text-muted-foreground shrink-0 sm:w-32 pt-2">
                  Build host
                  <span className="block font-normal text-[10px] text-muted-foreground/80 mt-0.5 normal-case">
                    Optional
                  </span>
                </label>
                <div className="flex-1 min-w-0 space-y-1">
                  {isPrebuiltImageMode ? (
                    <div
                      role="alert"
                      className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2.5 text-xs text-red-200/95 leading-relaxed flex gap-2.5"
                    >
                      <AlertTriangle className="size-4 shrink-0 text-red-400 mt-0.5" aria-hidden />
                      <span>
                        <strong className="text-red-100">Pre-built image mode</strong> — deploy pulls your image and does
                        not run <code className="text-red-100/90 font-mono text-[11px]">docker build</code>. Build host
                        choices are ignored until you switch back to building from source.
                      </span>
                    </div>
                  ) : null}
                  <select
                    value={buildValue}
                    onChange={(e) => setBuildValue(e.target.value)}
                    disabled={isPrebuiltImageMode}
                    aria-disabled={isPrebuiltImageMode}
                    className="w-full rounded-lg border border-border bg-muted dark:bg-black/40 px-3 py-2 text-sm text-foreground outline-none focus:border-primary/40 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
                  >
                    <option value="">
                      {cloud ? "Same as deploy host" : "Same as deploy host (or local if no deploy host)"}
                    </option>
                    <option value={BUILD_ON_API_VALUE}>Build on this server (API Docker)</option>
                    {buildOptions.map((r) => (
                      <option key={r.id} value={String(r.id)}>
                        {r.name} — {r.sshUser}@{r.host}
                        {r.port !== 22 ? `:${r.port}` : ""}
                      </option>
                    ))}
                  </select>
                  {!isPrebuiltImageMode ? (
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      <strong className="text-foreground/90">API Docker</strong> builds on the machine running Weehawk
                      (then push/pull via registry if deploy is remote). Otherwise build follows deploy host or a
                      build-role server.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
            {isApplication && showRegistryImageField ? (
              <div className="flex flex-col sm:flex-row sm:items-start gap-3 max-w-xl border-t border-white/5 pt-4">
                <label className="text-xs text-muted-foreground shrink-0 sm:w-32 pt-2">
                  Registry image
                  <span className="block font-normal text-[10px] text-amber-200/90 mt-0.5 normal-case">
                    Required here
                  </span>
                </label>
                <div className="flex-1 min-w-0 space-y-2">
                  <input
                    type="text"
                    value={registryValue}
                    onChange={(e) => setRegistryValue(e.target.value)}
                    placeholder="e.g. ghcr.io/myorg/myapp:latest"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    aria-required
                    className="w-full rounded-lg border border-border bg-muted dark:bg-black/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/40 font-mono"
                  />
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Sign in on{" "}
                    <Link href="/registry" className="text-primary hover:underline">
                      Registry
                    </Link>{" "}
                    on this server first.
                  </p>
                </div>
              </div>
            ) : null}
          </>
        )}
        {(q.data ?? []).length === 0 && !q.isLoading && !q.isError && (
          <p className="text-xs text-muted-foreground mt-1">
            No remote machines yet. Add one under{" "}
            <Link href="/remote-server" className="text-primary hover:underline">
              Remote servers
            </Link>
            .
          </p>
        )}
        {(q.data ?? []).length > 0 &&
          deployOptions.length === 0 &&
          !q.isLoading &&
          !q.isError && (
            <p className="text-xs text-amber-200/90 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2">
              Only <strong>Build</strong> hosts here—add a <strong>Deploy</strong> host or use this server.
            </p>
          )}
        {isApplication &&
          buildOptions.length === 0 &&
          (q.data ?? []).length > 0 &&
          !q.isLoading &&
          !q.isError && (
            <p className="text-[11px] text-muted-foreground">
              No build-only hosts yet—builds follow deploy for now.
            </p>
          )}
      </div>
    </div>
  );
}
