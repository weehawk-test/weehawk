"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Copy, Loader2, RefreshCw, Server } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { fetchRemoteServers } from "@/lib/remote-servers-api";
import type { Service } from "@/lib/schema";
import { useUpdateService } from "@/hooks/use-services";
import { syncRemoteDeploymentMirrorApi } from "@/lib/services-api";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { parseApplicationDeployMode } from "@/lib/env-utils";
import { hostsFromRemoteServerDomainsJson } from "@/lib/remote-server-domains-json";
import { API_BASE } from "@/lib/api";
import {
  createWebhook,
  deleteWebhook,
  fetchWebhooks,
  hooksPublicHostForDisplay,
  type WebhookRemoteTriggerUrlScheme,
} from "@/lib/webhooks-api";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/** Select value: build with the API host’s local Docker daemon (not SSH). */
const BUILD_ON_API_VALUE = "__local_api__";

/** Keep in sync with `WEEHAWK_REMOTE_DEPLOYMENTS_BASE` in apps/api remote-servers.service. */
const REMOTE_DEPLOYMENTS_DIR = "/opt/weehawk-deployments";

function toSafePathSegment(raw: string | undefined): string {
  const normalized = (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "service";
}

function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\"'\"'`)}'`;
}

/** Bash run on the deploy host. Matches API `buildOnHostRedeployScriptBody` / executor redeploy. */
function buildOnHostRedeployScript(service: Service): string {
  /** Same rules as API mirror: path segment from appName only (see `toSafePathSegment` + `service.appName || 'service'`). */
  const appNameRaw = (service.appName ?? "").trim() || "service";
  const dirSeg = toSafePathSegment(appNameRaw);
  const root = `${REMOTE_DEPLOYMENTS_DIR}/${dirSeg}`;
  const rootQ = shSingleQuote(root);
  const nameQ = shSingleQuote(appNameRaw);

  if (service.type === "docker-compose") {
    return `set -euo pipefail
if [ ! -d ${rootQ} ]; then
  echo 'Bundle directory missing (Weehawk has not mirrored compose here). Deploy from Weehawk or POST sync-remote-deployment-mirror.' >&2
  exit 1
fi
cd ${rootQ}
COMPOSE_FILE=""
for cand in docker-compose.yml compose.yaml docker-compose.yaml; do
  if [ -f "$cand" ] && [ -r "$cand" ]; then COMPOSE_FILE=$cand; break; fi
done
if [ -z "$COMPOSE_FILE" ]; then echo 'No compose file in this bundle folder. Deploy or sync mirror to this host.' >&2; ls -la >&2; exit 1; fi
_WH_LOG=$(mktemp 2>/dev/null || echo "/tmp/weehawk-redeploy.$$.log")
trap 'rm -f "$_WH_LOG"' EXIT
docker compose -f "$COMPOSE_FILE" -p ${nameQ} stop >/dev/null 2>&1 || true
if ! docker compose -f "$COMPOSE_FILE" -p ${nameQ} up -d --build >"$_WH_LOG" 2>&1; then cat "$_WH_LOG" >&2; exit 1; fi
echo "Weehawk redeploy: OK (compose)."
`;
  }

  return `set -euo pipefail
if [ ! -d ${rootQ} ]; then
  echo 'Bundle directory missing (Weehawk has not mirrored compose here). Deploy from Weehawk or POST sync-remote-deployment-mirror.' >&2
  exit 1
fi
cd ${rootQ}
COMPOSE_FILE=""
for cand in docker-compose.yml compose.yaml docker-compose.yaml; do
  if [ -f "$cand" ] && [ -r "$cand" ]; then COMPOSE_FILE=$cand; break; fi
done
if [ -z "$COMPOSE_FILE" ]; then echo 'No compose file in this bundle folder. Deploy or sync mirror to this host.' >&2; ls -la >&2; exit 1; fi
[ -f weehawk-stack-env.sh ] && . ./weehawk-stack-env.sh
if [ -d docker-config ] && [ -f docker-config/config.json ]; then
  export DOCKER_CONFIG="$(pwd)/docker-config"
fi
_WH_LOG=$(mktemp 2>/dev/null || echo "/tmp/weehawk-redeploy.$$.log")
trap 'rm -f "$_WH_LOG"' EXIT
if ! docker stack deploy -c "$COMPOSE_FILE" --with-registry-auth ${nameQ} >"$_WH_LOG" 2>&1; then cat "$_WH_LOG" >&2; exit 1; fi
SERVICES=$(docker stack services ${nameQ} --format "{{.Name}}" 2>/dev/null || true)
for svc in $SERVICES; do
  [ -n "$svc" ] && docker service update --force "$svc" >/dev/null 2>&1 || true
done
echo "Weehawk redeploy: OK (stack)."
`;
}

/** Short label for long hook URLs; full string in `title` / clipboard. */
function abbreviateTriggerUrl(url: string, headChars = 36, tailChars = 12): string {
  const max = headChars + 1 + tailChars;
  if (url.length <= max) return url;
  return `${url.slice(0, headChars)}…${url.slice(-tailChars)}`;
}

export function ServiceRemoteHostPanel({ service }: { service: Service }) {
  const { accessToken } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateService = useUpdateService();
  const isApplication = service.type === "application";

  /** Pre-built image deploy skips `docker build`; build host is ignored by the server. */
  const isPrebuiltImageMode = useMemo(
    () => parseApplicationDeployMode(service.config ?? "") === "image",
    [service.config],
  );

  const q = useQuery({
    queryKey: ["remote-servers"],
    queryFn: () => fetchRemoteServers(accessToken ?? ""),
    enabled: Boolean(accessToken),
  });

  const webhooksQ = useQuery({
    queryKey: ["webhooks", { includeHidden: true }],
    queryFn: () => fetchWebhooks(accessToken!, { includeHidden: true }),
    enabled: Boolean(accessToken),
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

  /** Parent domain from Domains page; API stores weehawk-webhook.<this-host>. */
  const [webhookPublicHost, setWebhookPublicHost] = useState("");
  const [webhookTriggerScheme, setWebhookTriggerScheme] =
    useState<WebhookRemoteTriggerUrlScheme>("http");
  const [saveFlowPending, setSaveFlowPending] = useState(false);
  const [regenerateWebhookPending, setRegenerateWebhookPending] = useState(false);
  /** Shown here immediately after create; list refetch then supplies the same URL. */
  const [publicRedeployTriggerUrl, setPublicRedeployTriggerUrl] = useState<string | null>(null);

  const redeployWebhookRow = useMemo(() => {
    const list = webhooksQ.data;
    if (!list?.length) return null;
    const publicName = `Redeploy · ${service.name}`;
    const rsId = service.remoteServerId ?? null;
    return (
      list.find(
        (w) =>
          w.name === publicName &&
          w.serviceAction === "docker_command" &&
          Boolean(w.remoteTriggerUrl?.trim()) &&
          (rsId == null || w.remoteServerId === rsId),
      ) ?? null
    );
  }, [webhooksQ.data, service.name, service.remoteServerId]);

  const redeployUrlFromApiList = redeployWebhookRow?.remoteTriggerUrl?.trim() ?? null;

  const displayRedeployTriggerUrl = redeployUrlFromApiList ?? publicRedeployTriggerUrl;

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

  const selectedDeployServer = useMemo(
    () => deployOptions.find((r) => String(r.id) === value) ?? null,
    [deployOptions, value],
  );
  const webhookHostOptions = useMemo(
    () => hostsFromRemoteServerDomainsJson(selectedDeployServer?.domainsJson ?? null),
    [selectedDeployServer?.domainsJson],
  );

  useEffect(() => {
    setWebhookPublicHost((prev) => {
      if (webhookHostOptions.length === 0) return "";
      if (prev && webhookHostOptions.some((h) => h.toLowerCase() === prev.toLowerCase())) return prev;
      return webhookHostOptions[0] ?? "";
    });
  }, [webhookHostOptions]);

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

  const save = async () => {
    if (value === "") {
      toast({
        title: "Remote host required",
        description: "Deploy host must be a remote Deploy server. Local server is build-only.",
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

    const deployServerIdNum = Number.isFinite(Number(value)) ? Number(value) : null;
    const wantRedeployWebhookChain =
      deployDirty &&
      deployServerIdNum != null &&
      deployServerIdNum >= 1 &&
      webhookHostOptions.length > 0;

    if (wantRedeployWebhookChain) {
      const wh = webhookPublicHost.trim();
      if (
        !wh ||
        !webhookHostOptions.some((h) => h.toLowerCase() === wh.toLowerCase())
      ) {
        toast({
          title: "Webhook domain required",
          description:
            "Choose which hostname will expose the redeploy URL (weehawk-webhook.<your-domain> via Traefik).",
          variant: "destructive",
        });
        return;
      }
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

    setSaveFlowPending(true);
    try {
      await updateService.mutateAsync({ id: service.id, patch });

      let extra = "";
      if (wantRedeployWebhookChain && accessToken && deployServerIdNum != null) {
        const parentHost = webhookPublicHost.trim();
        try {
          await syncRemoteDeploymentMirrorApi(String(service.id));
          const dockerCommand = buildOnHostRedeployScript(service);
          const outer = await createWebhook(accessToken, {
            name: `Redeploy · ${service.name}`,
            description: `On-host redeploy for ${REMOTE_DEPLOYMENTS_DIR}/${toSafePathSegment((service.appName ?? "").trim() || "service")}. Compose is synced to this path when you save here.`,
            targetMode: "service",
            serviceId: Number(service.id),
            serviceAction: "docker_command",
            dockerCommand,
            remoteServerId: deployServerIdNum,
            hooksPublicHost: parentHost,
            remoteTriggerUrlScheme: webhookTriggerScheme,
            hiddenFromWebhooksList: true,
            hooksTriggerOrigin: new URL(API_BASE).origin,
          });
          setPublicRedeployTriggerUrl(outer.remoteTriggerUrl?.trim() ?? null);
          await queryClient.invalidateQueries({ queryKey: ["webhooks"] });
        } catch (whErr) {
          toast({
            title: "Saved; webhook setup failed",
            description: (whErr as Error).message,
            variant: "destructive",
          });
          return;
        }
      } else if (deployDirty && deployServerIdNum != null && webhookHostOptions.length === 0) {
        extra =
          " Add hostnames for this deploy server on Domains to create a redeploy webhook from here next time.";
      }

      toast({
        title: "Saved",
        description: `Host choices updated for this service.${extra}`,
      });
    } catch (e) {
      toast({
        title: "Could not save",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setSaveFlowPending(false);
    }
  };

  const regenerateRedeployWebhook = async () => {
    if (!accessToken) return;
    const hit = redeployWebhookRow;
    if (!hit) {
      toast({
        title: "No redeploy webhook",
        description: "Save the deploy host with Domains configured to create one first.",
        variant: "destructive",
      });
      return;
    }
    const parentHost = hooksPublicHostForDisplay(hit.hooksPublicHost);
    if (!parentHost.trim()) {
      toast({
        title: "Cannot regenerate",
        description: "This webhook has no saved public hostname.",
        variant: "destructive",
      });
      return;
    }
    const deployServerIdNum = hit.remoteServerId;
    if (deployServerIdNum == null || deployServerIdNum < 1) {
      toast({
        title: "Cannot regenerate",
        description: "This webhook is not tied to a deploy server.",
        variant: "destructive",
      });
      return;
    }
    const oldId = hit.id;
    setRegenerateWebhookPending(true);
    try {
      await syncRemoteDeploymentMirrorApi(String(service.id));
      const outer = await createWebhook(accessToken, {
        name: `Redeploy · ${service.name}`,
        description: `On-host redeploy for ${REMOTE_DEPLOYMENTS_DIR}/${toSafePathSegment((service.appName ?? "").trim() || "service")}. Compose is synced to this path when you regenerate here.`,
        targetMode: "service",
        serviceId: Number(service.id),
        serviceAction: "docker_command",
        dockerCommand: buildOnHostRedeployScript(service),
        remoteServerId: deployServerIdNum,
        hooksPublicHost: parentHost,
        remoteTriggerUrlScheme: hit.remoteTriggerUrlScheme === "https" ? "https" : "http",
        hiddenFromWebhooksList: true,
        hooksTriggerOrigin: new URL(API_BASE).origin,
      });
      let deleteProblem = "";
      try {
        await deleteWebhook(accessToken, oldId);
      } catch (delErr) {
        deleteProblem = (delErr as Error).message;
      }
      setPublicRedeployTriggerUrl(outer.remoteTriggerUrl?.trim() ?? null);
      await queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      toast({
        title: "Webhook regenerated",
        description: deleteProblem
          ? `New URL is active. Could not delete the old webhook automatically: ${deleteProblem}`
          : "Use the new trigger URL; the previous one no longer works.",
        variant: deleteProblem ? "destructive" : "default",
      });
    } catch (e) {
      toast({
        title: "Regenerate failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setRegenerateWebhookPending(false);
    }
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
              Deploy / build hosts, then <strong>Save</strong>.{" "}
              <Link href="/remote-server" className="text-primary hover:underline">
                Remote servers
              </Link>{" "}
              for SSH. Split build & deploy:{" "}
              <Link href="/registry" className="text-primary hover:underline">
                Registry
              </Link>{" "}
              + image field below.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={!dirty || updateService.isPending || saveFlowPending}
            onClick={() => void save()}
            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 disabled:opacity-40 disabled:pointer-events-none"
          >
            {updateService.isPending || saveFlowPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              "Save"
            )}
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
            {displayRedeployTriggerUrl ? (
              <div className="max-w-2xl space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">Redeploy trigger URL</p>
                  <button
                    type="button"
                    disabled={regenerateWebhookPending || webhooksQ.isFetching}
                    onClick={() => void regenerateRedeployWebhook()}
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors disabled:opacity-50 disabled:pointer-events-none shrink-0"
                  >
                    {regenerateWebhookPending ? (
                      <Loader2 className="size-3 animate-spin" aria-hidden />
                    ) : (
                      <RefreshCw className="size-3" aria-hidden />
                    )}
                    Regenerate
                  </button>
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <a
                    href={displayRedeployTriggerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={displayRedeployTriggerUrl}
                    className="min-w-0 flex-1 truncate rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-sm font-mono text-primary hover:underline"
                  >
                    {abbreviateTriggerUrl(displayRedeployTriggerUrl)}
                  </a>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(displayRedeployTriggerUrl);
                        toast({ title: "Copied", description: "Trigger URL copied to clipboard." });
                      } catch {
                        toast({
                          title: "Copy failed",
                          description: "Could not access the clipboard.",
                          variant: "destructive",
                        });
                      }
                    }}
                    className="shrink-0 inline-flex items-center justify-center rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
                    aria-label="Copy trigger URL"
                  >
                    <Copy className="size-3.5" />
                  </button>
                </div>
              </div>
            ) : null}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 max-w-xl">
              <label className="text-xs text-muted-foreground shrink-0 sm:w-32">Deploy host</label>
              <select
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="flex-1 min-w-0 rounded-lg border border-border bg-muted dark:bg-black/40 px-3 py-2 text-sm text-foreground outline-none focus:border-primary/40"
              >
                {deployOptions.length === 0 ? (
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
            {value !== "" ? (
              <div className="rounded-xl border border-white/10 bg-muted/20 px-4 py-3 space-y-3 max-w-xl">
                <p className="text-xs font-medium text-foreground">Redeploy webhook (on Save)</p>
                {webhookHostOptions.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Add at least one hostname for this deploy server on{" "}
                    <Link href="/domains" className="text-primary hover:underline">
                      Domains
                    </Link>{" "}
                    to choose the public URL. Saving the deploy host still works without it.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <label className="text-xs text-muted-foreground shrink-0 sm:w-32">
                        Webhook domain
                      </label>
                      <select
                        value={webhookPublicHost}
                        onChange={(e) => setWebhookPublicHost(e.target.value)}
                        className="flex-1 min-w-0 rounded-lg border border-border bg-muted dark:bg-black/40 px-3 py-2 text-sm text-foreground outline-none focus:border-primary/40 font-mono"
                      >
                        {webhookHostOptions.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      When you save a deploy host change, Weehawk adds webhooks that redeploy this service.
                    </p>
                    <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-background/40 px-3 py-2.5">
                      <div className="space-y-0.5 min-w-0">
                        <Label
                          htmlFor="remote-panel-webhook-https"
                          className="text-xs font-medium text-foreground cursor-pointer"
                        >
                          HTTPS for trigger URL
                        </Label>
                        <p className="text-[10px] text-muted-foreground">
                          Match your Traefik / certificate setup for the webhook hostname.
                        </p>
                      </div>
                      <Switch
                        id="remote-panel-webhook-https"
                        checked={webhookTriggerScheme === "https"}
                        onCheckedChange={(v) =>
                          setWebhookTriggerScheme(v ? "https" : "http")
                        }
                        className="shrink-0"
                      />
                    </div>
                  </>
                )}
              </div>
            ) : null}
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
                      className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2.5 text-xs text-red-800 dark:text-red-200/95 leading-relaxed flex gap-2.5"
                    >
                      <AlertTriangle className="size-4 shrink-0 text-red-400 mt-0.5" aria-hidden />
                      <span>
                        <strong className="text-red-900 dark:text-red-100">Pre-built image mode</strong> — deploy pulls your image and does
                        not run <code className="text-red-900/90 dark:text-red-100/90 font-mono text-[11px]">docker build</code>. Build host
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
                      Same as deploy host
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
              Only <strong>Build</strong> hosts here—add a <strong>Deploy</strong> host. Local server is build-only.
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
