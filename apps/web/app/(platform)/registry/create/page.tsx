"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Globe2, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useOrgWorkspace } from "@/(platform)/org-workspace/org-workspace-context";
import { orgScopedQuerySegment } from "@/lib/react-query-scope";
import { fetchRemoteServers, runRemoteServerTerminalCommandApi } from "@/lib/remote-servers-api";
import { createRegistryAccountApi, registryVerifyApi } from "@/lib/registry-api";

type PresetId = "dockerhub" | "ghcr" | "gitlab" | "custom";

const PRESETS: Record<PresetId, { label: string; providerUrl: string }> = {
  dockerhub: { label: "Docker Hub", providerUrl: "docker.io" },
  ghcr: { label: "GitHub Registry", providerUrl: "ghcr.io" },
  gitlab: { label: "GitLab Registry", providerUrl: "registry.gitlab.com" },
  custom: { label: "Custom Registry", providerUrl: "" },
};

const PROVIDER_OPTIONS: Array<{ id: PresetId; label: string }> = [
  { id: "dockerhub", label: "Docker Hub" },
  { id: "ghcr", label: "GitHub" },
  { id: "gitlab", label: "GitLab" },
  { id: "custom", label: "Custom" },
];

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export default function RegistryCreatePage() {
  const router = useRouter();
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const orgPid = useOrgWorkspace().publicId.trim();

  const [preset, setPreset] = useState<PresetId>("dockerhub");
  const [providerUrl, setProviderUrl] = useState(PRESETS.dockerhub.providerUrl);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testRemoteId, setTestRemoteId] = useState<string>("");

  const remoteServersQ = useQuery({
    queryKey: ["remote-servers", orgScopedQuerySegment(orgPid)],
    queryFn: () => fetchRemoteServers(accessToken ?? "", orgPid),
    enabled: Boolean(accessToken && orgPid),
    staleTime: 120_000,
  });
  const deployServers = useMemo(
    () => (remoteServersQ.data ?? []).filter((s) => s.serverRole === "deploy"),
    [remoteServersQ.data],
  );

  const canSubmit = useMemo(
    () => Boolean(providerUrl.trim() && username.trim() && password.trim()),
    [providerUrl, username, password],
  );

  const setPresetAndProvider = (next: PresetId) => {
    setPreset(next);
    setProviderUrl(PRESETS[next].providerUrl);
  };

  const verifyConnection = async () => {
    if (!canSubmit || !testRemoteId) return;
    setIsVerifying(true);
    try {
      if (!accessToken) throw new Error("Sign in required");
      const provider = providerUrl.trim();
      const user = username.trim();
      const cmd = [
        "set -e",
        `printf %s ${shellSingleQuote(password)} | docker login ${shellSingleQuote(provider)} -u ${shellSingleQuote(user)} --password-stdin`,
        `docker logout ${shellSingleQuote(provider)} >/dev/null 2>&1 || true`,
        "echo 'Registry credentials are valid'",
      ].join(" && ");
      const out = await runRemoteServerTerminalCommandApi(accessToken, testRemoteId, cmd);
      if (!out.success) {
        throw new Error(out.output || "Remote verification failed");
      }
      toast({
        title: "Connection verified",
        description: "Verified from selected deploy server.",
      });
    } catch (e) {
      // Fallback: keep legacy control-plane verify if remote test fails due endpoint permission/routing.
      try {
        const res = await registryVerifyApi(accessToken ?? null, {
          providerUrl: providerUrl.trim(),
          username: username.trim(),
          password,
        });
        toast({ title: "Connection verified", description: res.message });
      } catch (inner) {
        toast({
          title: "Verification failed",
          description: inner instanceof Error ? inner.message : String(inner),
          variant: "destructive",
        });
      }
    } finally {
      setIsVerifying(false);
    }
  };

  const saveRegistry = async () => {
    if (!accessToken || !orgPid || !canSubmit) return;
    setIsSaving(true);
    try {
      await createRegistryAccountApi(accessToken, orgPid, {
        name: preset === "custom" ? providerUrl.trim() : PRESETS[preset].label,
        providerUrl: providerUrl.trim(),
        username: username.trim(),
        password,
      });
      await queryClient.invalidateQueries({
        queryKey: ["registry-accounts", orgScopedQuerySegment(orgPid)],
      });
      toast({ title: "Registry account saved" });
      router.push("/registry");
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

  return (
    <div className="fixed inset-0 z-[70] modal-scrim flex items-center justify-center px-4 py-6 md:px-6 md:py-8">
      <div className="w-full max-w-2xl glass-panel rounded-xl border border-primary/25 p-5 sm:p-6">
        <div className="mb-4">
          <h1 className="text-base font-semibold">Add Registry Account</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Add Docker Hub, GHCR, GitLab, or custom registry credentials.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Provider</label>
            <div className="rounded-lg border border-border bg-muted/60 p-2.5 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {PROVIDER_OPTIONS.map((option) => {
                  const active = preset === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setPresetAndProvider(option.id)}
                      className={`flex h-full min-h-[4.25rem] w-full min-w-0 flex-col items-center justify-center gap-1 text-center rounded-md border px-1 py-2 text-[0.7rem] leading-tight transition-colors sm:text-xs ${
                        active
                          ? "border-primary/50 bg-primary/10 text-foreground dark:border-primary/60 dark:bg-primary/15"
                          : "border-border bg-background/80 text-muted-foreground hover:bg-muted hover:text-foreground dark:border-white/10 dark:bg-white/[0.02] dark:hover:bg-white/[0.06]"
                      }`}
                    >
                      <span className="inline-flex size-7 shrink-0 items-center justify-center align-middle">
                        {option.id === "dockerhub" ? (
                          <img src="/registry/docker-hub.svg" alt="" className="h-7 w-7 object-contain" />
                        ) : option.id === "ghcr" ? (
                          <img src="/deployment-sources/github.svg" alt="" className="h-7 w-7 object-contain dark:invert" />
                        ) : option.id === "gitlab" ? (
                          <img src="/deployment-sources/gitlab.svg" alt="" className="h-7 w-7 object-contain" />
                        ) : (
                          <Globe2 className="h-7 w-7 text-sky-500" />
                        )}
                      </span>
                      <span className="line-clamp-2 w-full px-0.5">{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Registry URL</label>
            <input
              className={`input-field font-mono text-sm ${preset !== "custom" ? "opacity-80 cursor-not-allowed" : ""}`}
              value={providerUrl}
              onChange={(e) => setProviderUrl(e.target.value)}
              readOnly={preset !== "custom"}
              placeholder="docker.io or registry.example.com"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Username</label>
              <input
                className="input-field"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Password / Token</label>
              <input
                type="password"
                className="input-field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="token or password"
              />
            </div>
          </div>

          <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-4 md:p-5">
            <div className="flex flex-col gap-1 mb-3">
              <span className="text-sm font-semibold text-foreground">Test connection</span>
              <span className="text-xs text-muted-foreground">
                Optional: verify registry credentials now. You can still add the account without testing.
              </span>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                Run test from (optional)
              </label>
              <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                <select
                  className="input-field text-sm w-full sm:flex-1"
                  value={testRemoteId}
                  onChange={(e) => setTestRemoteId(e.target.value)}
                  disabled={isVerifying || isSaving}
                >
                  <option value="">Select a deploy host...</option>
                  {deployServers.map((srv) => (
                    <option key={srv.id} value={String(srv.publicId ?? srv.id)}>
                      {srv.name} ({srv.host})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void verifyConnection()}
                  disabled={!canSubmit || isVerifying || isSaving || testRemoteId === ""}
                  className="btn-secondary inline-flex items-center justify-center gap-1.5 min-w-[7rem] disabled:opacity-50"
                >
                  {isVerifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
                  Test
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Link href="/registry" className="btn-secondary">
            Cancel
          </Link>
          <button
            type="button"
            onClick={() => void saveRegistry()}
            disabled={!canSubmit || isVerifying || isSaving}
            className="btn-primary disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
