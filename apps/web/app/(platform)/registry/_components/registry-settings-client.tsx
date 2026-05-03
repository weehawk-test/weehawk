"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { CheckCircle2, Globe2, Loader2, LogIn } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import {
  createRegistryAccountApi,
  deleteRegistryAccountApi,
  fetchRegistryAccounts,
  registryVerifyApi,
} from "@/lib/registry-api";
import { RegistryBreadcrumb } from "./registry-breadcrumb";
import { REGISTRY_ACCOUNTS_QUERY_SCOPE } from "@/lib/react-query-scope";

type PresetId = "dockerhub" | "ghcr" | "gitlab" | "custom";

type Props = {
  preset: PresetId;
};

const PRESET_META: Record<
  PresetId,
  { title: string; defaultProviderUrl: string; hint: string; saveLabel: string; icon: "dockerhub" | "ghcr" | "gitlab" | "custom" }
> = {
  dockerhub: {
    title: "Docker Hub",
    defaultProviderUrl: "docker.io",
    hint: "Use your Docker Hub username and PAT/password.",
    saveLabel: "Save Docker Hub",
    icon: "dockerhub",
  },
  ghcr: {
    title: "GitHub Registry",
    defaultProviderUrl: "ghcr.io",
    hint: "Use your GitHub username and personal access token.",
    saveLabel: "Save GHCR",
    icon: "ghcr",
  },
  gitlab: {
    title: "GitLab Registry",
    defaultProviderUrl: "registry.gitlab.com",
    hint: "Use your GitLab username and personal/group token.",
    saveLabel: "Save GitLab Registry",
    icon: "gitlab",
  },
  custom: {
    title: "Custom Registry",
    defaultProviderUrl: "",
    hint: "Set your private registry URL (example: registry.example.com).",
    saveLabel: "Save Custom Registry",
    icon: "custom",
  },
};

function ProviderIcon({ preset }: { preset: PresetId }) {
  if (preset === "dockerhub") {
    return <img src="/registry/docker-hub.svg" alt="" className="h-14 w-14 object-contain" />;
  }
  if (preset === "ghcr") {
    return (
      <Image
        src="/deployment-sources/github.svg"
        alt=""
        width={56}
        height={56}
        className="h-14 w-14 object-contain dark:invert"
      />
    );
  }
  if (preset === "gitlab") {
    return (
      <Image
        src="/deployment-sources/gitlab.svg"
        alt=""
        width={56}
        height={56}
        className="h-14 w-14 object-contain"
      />
    );
  }
  return <Globe2 className="h-14 w-14 text-sky-500" />;
}

export function RegistrySettingsClient({ preset }: Props) {
  const meta = PRESET_META[preset];
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [providerUrl, setProviderUrl] = useState(meta.defaultProviderUrl);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isClearingToken, setIsClearingToken] = useState(false);

  const accountsQ = useQuery({
    queryKey: ["registry-accounts", REGISTRY_ACCOUNTS_QUERY_SCOPE],
    queryFn: () => fetchRegistryAccounts(accessToken ?? ""),
    enabled: Boolean(accessToken),
  });

  const canAuth = useMemo(
    () => Boolean(providerUrl.trim() && username.trim() && password.trim()),
    [providerUrl, username, password],
  );
  const normalizedProviderUrl = providerUrl.trim().toLowerCase();
  const visibleSavedAccount = useMemo(() => {
    const accounts = accountsQ.data ?? [];
    if (preset === "custom") {
      return (
        accounts.find((a) => a.providerUrl.trim().toLowerCase() === normalizedProviderUrl) ??
        accounts.find((a) => {
          const u = a.providerUrl.trim().toLowerCase();
          return u !== "docker.io" && u !== "ghcr.io" && u !== "registry.gitlab.com";
        }) ??
        null
      );
    }
    return (
      accounts.find((a) => a.providerUrl.trim().toLowerCase() === meta.defaultProviderUrl.toLowerCase()) ?? null
    );
  }, [accountsQ.data, preset, normalizedProviderUrl, meta.defaultProviderUrl]);

  useEffect(() => {
    if (!visibleSavedAccount) return;
    if (!username.trim()) setUsername(visibleSavedAccount.username);
    if (preset === "custom" && !providerUrl.trim()) {
      setProviderUrl(visibleSavedAccount.providerUrl);
    }
  }, [visibleSavedAccount, username, providerUrl, preset]);

  const verifyConnection = async () => {
    if (!canAuth) return;
    setIsVerifying(true);
    try {
      const res = await registryVerifyApi(accessToken ?? null, {
        providerUrl: providerUrl.trim(),
        username: username.trim(),
        password,
      });
      toast({ title: "Connection verified", description: res.message });
    } catch (e) {
      toast({
        title: "Verification failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const saveRegistry = async () => {
    if (!accessToken) {
      toast({ title: "Sign in required", description: "Log in to save registry credentials.", variant: "destructive" });
      return;
    }
    if (!canAuth) return;
    setIsSaving(true);
    try {
      const provider = providerUrl.trim();
      const name = preset === "custom" ? provider || "Custom registry" : meta.title;
      await createRegistryAccountApi(accessToken, {
        name,
        providerUrl: provider,
        username: username.trim(),
        password,
      });
      await queryClient.invalidateQueries({ queryKey: ["registry-accounts"] });
      toast({
        title: "Registry saved",
        description: "Verified and stored on the server (encrypted). Used automatically for image push.",
      });
      setPassword("");
    } catch (e) {
      toast({
        title: "Save failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const clearAccessToken = async () => {
    if (!accessToken || !visibleSavedAccount) return;
    setIsClearingToken(true);
    try {
      await deleteRegistryAccountApi(accessToken, visibleSavedAccount.id);
      await queryClient.invalidateQueries({ queryKey: ["registry-accounts"] });
      toast({ title: "Secret cleared", description: "Saved access token was removed." });
    } catch (e) {
      toast({
        title: "Could not clear",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setIsClearingToken(false);
    }
  };

  return (
    <div className="w-full space-y-8 pb-12">
      <RegistryBreadcrumb current={preset} />

      <div className="flex items-start gap-4">
        <div className="rounded-2xl border border-zinc-200/90 bg-white p-3 shadow-md shadow-zinc-900/5 dark:border-white/10 dark:bg-zinc-950 dark:shadow-lg shrink-0">
          <ProviderIcon preset={preset} />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{meta.title}</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl leading-relaxed">
            Verify and store registry credentials for image push/pull operations.
          </p>
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-6 md:p-8 space-y-5">
        <h2 className="text-base font-semibold">Registry connection</h2>
        <p className="text-xs text-muted-foreground leading-relaxed -mt-2">{meta.hint}</p>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Registry URL</label>
          <input
            className={`input-field w-full font-mono ${preset !== "custom" ? "opacity-80 cursor-not-allowed" : ""}`}
            value={providerUrl}
            onChange={(e) => setProviderUrl(e.target.value)}
            placeholder="docker.io or registry.example.com"
            autoComplete="off"
            readOnly={preset !== "custom"}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-foreground">Username</label>
          <input
            className="input-field w-full"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="username"
            autoComplete="username"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-foreground">Password / Access Token</label>
          <input
            type="password"
            className="input-field w-full font-mono text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your PAT or registry password"
            autoComplete="new-password"
          />
          {visibleSavedAccount ? (
            <button
              type="button"
              className="text-[11px] text-destructive/80 hover:text-destructive disabled:opacity-50"
              disabled={isClearingToken || isSaving || isVerifying}
              onClick={() => void clearAccessToken()}
            >
              Clear access token
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => void verifyConnection()}
            disabled={!canAuth || isVerifying || isSaving}
            className="btn-secondary inline-flex items-center gap-2 border border-primary/35 text-primary disabled:opacity-50"
          >
            {isVerifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Verify
          </button>
          <button
            type="button"
            onClick={() => void saveRegistry()}
            disabled={!canAuth || isVerifying || isSaving || isClearingToken}
            className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            {meta.saveLabel}
          </button>
        </div>

      </div>
    </div>
  );
}
