"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Server } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { fetchRemoteServers } from "@/lib/remote-servers-api";
import type { Service } from "@/lib/schema";
import { useUpdateService } from "@/hooks/use-services";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";

export function ServiceRemoteHostPanel({ service }: { service: Service }) {
  const { accessToken } = useAuth();
  const { toast } = useToast();
  const updateService = useUpdateService();
  const isApplication = service.type === "application";

  const q = useQuery({
    queryKey: ["remote-servers"],
    queryFn: () => fetchRemoteServers(accessToken ?? ""),
    enabled: Boolean(accessToken),
  });

  const [value, setValue] = useState<string>(() =>
    service.remoteServerId != null ? String(service.remoteServerId) : "",
  );

  const [buildValue, setBuildValue] = useState<string>(() =>
    service.buildRemoteServerId != null ? String(service.buildRemoteServerId) : "",
  );

  const [registryValue, setRegistryValue] = useState<string>(() => service.registryPushImage ?? "");

  const currentId = service.remoteServerId ?? null;
  const currentBuildId = service.buildRemoteServerId ?? null;

  useEffect(() => {
    setValue(currentId != null ? String(currentId) : "");
  }, [currentId]);

  useEffect(() => {
    setBuildValue(currentBuildId != null ? String(currentBuildId) : "");
  }, [currentBuildId]);

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
    const deployId = value === "" ? null : Number(value);
    const effectiveBuildId =
      buildValue === ""
        ? deployId
        : Number.isFinite(Number(buildValue))
          ? Number(buildValue)
          : null;
    return deployId !== effectiveBuildId;
  }, [isApplication, value, buildValue]);

  const deployDirty =
    (value === "" && currentId !== null) || (value !== "" && Number(value) !== currentId);
  const buildDirty =
    isApplication &&
    ((buildValue === "" && currentBuildId !== null) ||
      (buildValue !== "" && Number(buildValue) !== currentBuildId));
  const currentRegistry = (service.registryPushImage ?? "").trim();
  const registryDirty =
    showRegistryImageField && registryValue.trim() !== currentRegistry;
  /** Saved registry ref no longer needed (same build/deploy daemon) — offer Save to clear it. */
  const staleRegistryWhenMerged =
    isApplication && !showRegistryImageField && currentRegistry !== "";
  const dirty =
    deployDirty || buildDirty || registryDirty || staleRegistryWhenMerged;

  const save = () => {
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
      registryPushImage?: string | null;
    } = {};
    if (deployDirty) {
      patch.remoteServerId =
        value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
    }
    if (buildDirty) {
      patch.buildRemoteServerId =
        buildValue === ""
          ? null
          : Number.isFinite(Number(buildValue))
            ? Number(buildValue)
            : null;
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
                className="flex-1 min-w-0 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-foreground outline-none focus:border-primary/40"
              >
                <option value="">This server (local Docker)</option>
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
                  <select
                    value={buildValue}
                    onChange={(e) => setBuildValue(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-foreground outline-none focus:border-primary/40"
                  >
                    <option value="">Same as deploy host (or local if no deploy host)</option>
                    {buildOptions.map((r) => (
                      <option key={r.id} value={String(r.id)}>
                        {r.name} — {r.sshUser}@{r.host}
                        {r.port !== 22 ? `:${r.port}` : ""}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Optional: build on another machine; deploy stays above.
                  </p>
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
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/40 font-mono"
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
