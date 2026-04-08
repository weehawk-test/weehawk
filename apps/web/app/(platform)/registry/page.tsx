"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck,
  CheckCircle2,
  LogIn,
  Loader2,
  Plus,
  Search,
  Trash2,
  LogOut,
  X,
  Globe2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { useBulkSelection } from "@/components/docker/useBulkSelection";
import { DockerBulkCheckbox } from "@/components/docker/DockerBulkCheckbox";
import { useAuth } from "@/contexts/auth-context";
import {
  registryLogoutApi,
  registryVerifyApi,
  fetchRegistryAccounts,
  createRegistryAccountApi,
  deleteRegistryAccountApi,
  type RegistryLoginPayload,
} from "@/lib/registry-api";

type ProviderPreset = {
  id: string;
  name: string;
  providerUrl: string;
  hint: string;
};

const REGISTRY_ICON_PICKER_WRAP =
  "inline-flex size-7 shrink-0 items-center justify-center align-middle [&_svg]:h-full [&_svg]:w-full [&_svg]:max-h-7 [&_svg]:max-w-7";
const REGISTRY_ICON_PICKER_INNER = "h-full w-full min-h-0 min-w-0";

function DockerHubLogoIcon({ className }: { className?: string }) {
  return <img src="/registry/docker-hub.svg" alt="" className={className} aria-hidden />;
}

function GitHubLogoIcon({ className }: { className?: string }) {
  return <img src="/deployment-sources/github.svg" alt="" className={`${className} dark:invert`} aria-hidden />;
}

function GitLabLogoIcon({ className }: { className?: string }) {
  return <img src="/deployment-sources/gitlab.svg" alt="" className={className} aria-hidden />;
}

const PRESETS: ProviderPreset[] = [
  {
    id: "dockerhub",
    name: "Docker Hub",
    providerUrl: "docker.io",
    hint: "Use your Docker Hub username + PAT/password.",
  },
  {
    id: "ghcr",
    name: "GitHub Registry",
    providerUrl: "ghcr.io",
    hint: "Use GitHub username + personal access token.",
  },
  {
    id: "gitlab",
    name: "GitLab Registry",
    providerUrl: "registry.gitlab.com",
    hint: "Use GitLab username + access token.",
  },
  {
    id: "custom",
    name: "Custom Registry",
    providerUrl: "",
    hint: "Example: registry.example.com",
  },
];

export default function RegistryPage() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => {
    setPortalReady(true);
  }, []);

  const accountsQ = useQuery({
    queryKey: ["registry-accounts"],
    queryFn: () => fetchRegistryAccounts(accessToken ?? ""),
    enabled: Boolean(accessToken),
  });
  const saved = accountsQ.data ?? [];
  const [presetId, setPresetId] = useState<string>("dockerhub");
  const [providerUrl, setProviderUrl] = useState<string>("docker.io");
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [logoutProvider, setLogoutProvider] = useState<string | null>(null);
  const [isBulkRemoving, setIsBulkRemoving] = useState(false);

  const canAuth = providerUrl.trim() && username.trim() && password.trim();
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return saved.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.providerUrl.toLowerCase().includes(q) ||
        s.username.toLowerCase().includes(q),
    );
  }, [saved, search]);
  const savedKeys = useMemo(() => filtered.map((s) => String(s.id)), [filtered]);
  const savedBulk = useBulkSelection(savedKeys);

  const applyPreset = (preset: ProviderPreset) => {
    setPresetId(preset.id);
    setProviderUrl(preset.providerUrl);
  };

  const buildPayload = (): RegistryLoginPayload => ({
    providerUrl: providerUrl.trim(),
    username: username.trim(),
    password,
  });

  const verifyConnection = async () => {
    if (!canAuth) {
      toast({
        title: "Missing fields",
        description: "Provider URL, username, and password are required.",
        variant: "destructive",
      });
      return;
    }
    setIsVerifying(true);
    try {
      const res = await registryVerifyApi(buildPayload());
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

  const login = async () => {
    if (!accessToken) {
      toast({ title: "Sign in required", description: "Log in to save registry credentials.", variant: "destructive" });
      return;
    }
    if (!canAuth) {
      toast({
        title: "Missing fields",
        description: "Provider URL, username, and password are required.",
        variant: "destructive",
      });
      return;
    }
    setIsLoggingIn(true);
    try {
      const provider = providerUrl.trim();
      const preset = PRESETS.find((p) => p.id === presetId);
      const name =
        presetId === "custom"
          ? provider || "Custom registry"
          : (preset?.name ?? provider);
      await createRegistryAccountApi(accessToken, {
        name,
        providerUrl: provider,
        username: username.trim(),
        password,
      });
      await qc.invalidateQueries({ queryKey: ["registry-accounts"] });
      toast({
        title: "Registry saved",
        description: `Verified and stored on the server (encrypted). Used automatically for image push.`,
      });
      setShowAdd(false);
      setPresetId("dockerhub");
      setProviderUrl("docker.io");
      setUsername("");
      setPassword("");
    } catch (e) {
      toast({
        title: "Save failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const logoutSaved = async (providerUrlValue: string) => {
    setLogoutProvider(providerUrlValue);
    try {
      await registryLogoutApi({ providerUrl: providerUrlValue });
      toast({
        title: "Logged out",
        description: `Session removed for ${providerUrlValue}.`,
      });
    } catch (e) {
      toast({
        title: "Logout failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setLogoutProvider(null);
    }
  };

  const removeSaved = async (id: number, name: string) => {
    if (!accessToken) return;
    const ok = await confirm({
      title: "Remove saved registry?",
      description: `This removes "${name}" from the server.`,
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await deleteRegistryAccountApi(accessToken, id);
      await qc.invalidateQueries({ queryKey: ["registry-accounts"] });
      toast({ title: "Removed", description: name });
    } catch (e) {
      toast({
        title: "Remove failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };
  const removeSelected = async () => {
    if (!accessToken) return;
    const ids = savedBulk.selectedInFiltered;
    if (ids.length === 0) return;
    const ok = await confirm({
      title: "Remove selected registries?",
      description: `Remove ${ids.length} saved profile(s) from the server?`,
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!ok) return;
    setIsBulkRemoving(true);
    try {
      for (const sid of ids) {
        await deleteRegistryAccountApi(accessToken, Number(sid));
      }
      await qc.invalidateQueries({ queryKey: ["registry-accounts"] });
      savedBulk.clear();
      toast({ title: "Removed", description: `${ids.length} profile(s) removed.` });
    } catch (e) {
      toast({
        title: "Remove failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setIsBulkRemoving(false);
    }
  };

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Registry</h1>
          <p className="text-muted-foreground">
            Verify and store registry credentials on the server.     
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (!accessToken) {
              toast({
                title: "Sign in required",
                description: "Log in to save registry credentials on the server.",
                variant: "destructive",
              });
              return;
            }
            setShowAdd(true);
          }}
          className="btn-primary flex items-center justify-center gap-2 shrink-0"
        >
          <Plus className="w-5 h-5" /> Add registry
        </button>
      </div>

      {accessToken ? (
        <div className="mb-4">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search registries..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field !pl-10 w-full bg-card/50"
            />
          </div>
          {filtered.length > 0 && (
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <DockerBulkCheckbox
                  checked={savedBulk.allSelected ? true : savedBulk.someSelected ? "indeterminate" : false}
                  onCheckedChange={() => savedBulk.toggleAllFiltered()}
                  aria-label="Select all registries on this page"
                />
                <span className="text-sm text-muted-foreground">
                  Select all on this page ({filtered.length})
                </span>
              </div>
              {savedBulk.selectedInFiltered.length > 0 && (
                <button
                  type="button"
                  onClick={removeSelected}
                  disabled={isBulkRemoving}
                  className="btn-secondary border-destructive/40 text-destructive hover:bg-destructive/10 flex items-center gap-2 text-sm"
                >
                  {isBulkRemoving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Delete ({savedBulk.selectedInFiltered.length})
                </button>
              )}
            </div>
          )}
        </div>
      ) : null}

      {!accessToken ? (
        <div className="glass-panel backdrop-blur-none p-12 rounded-2xl flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
            <ShieldCheck className="w-10 h-10 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-bold mb-2">Sign in required</h3>
          <p className="text-muted-foreground max-w-md text-sm">
            Sign in to view and add registry accounts stored on the server.
          </p>
        </div>
      ) : accountsQ.isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-9 h-9 animate-spin text-muted-foreground" />
        </div>
      ) : accountsQ.isError ? (
        <p className="text-sm text-red-400">{(accountsQ.error as Error).message}</p>
      ) : filtered.length === 0 ? (
        <div className="glass-panel backdrop-blur-none p-12 rounded-2xl flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
            <ShieldCheck className="w-10 h-10 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-bold mb-2">No registries yet</h3>
          <p className="text-muted-foreground mb-8 max-w-md">
            {search ? "No registries match your search." : "Add a registry to verify and save credentials on the server."}
          </p>
          {!search && (
            <button type="button" onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" /> Add registry
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="glass-panel backdrop-blur-none rounded-2xl p-6 flex flex-col min-h-[180px] group interactive-card"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 rounded-lg flex-shrink-0 bg-primary/10 text-primary">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-lg leading-tight truncate" title={item.name}>
                      {item.name}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1 font-mono truncate" title={item.providerUrl}>
                      {item.providerUrl}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 truncate" title={item.username}>
                      {item.username}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                  <button
                    type="button"
                    onClick={() => void removeSaved(item.id, item.name)}
                    disabled={isBulkRemoving}
                    className="p-2 rounded-md hover:bg-destructive/20 text-destructive transition-colors opacity-0 group-hover:opacity-100"
                    title="Remove saved profile"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <div
                    className={`transition-opacity ${
                      savedBulk.selected.has(String(item.id)) ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    <DockerBulkCheckbox
                      checked={savedBulk.selected.has(String(item.id))}
                      onCheckedChange={() => savedBulk.toggle(String(item.id))}
                      aria-label={`Select registry ${item.name}`}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-auto pt-4 border-t border-white/5 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => void logoutSaved(item.providerUrl)}
                  disabled={logoutProvider === item.providerUrl}
                  className="btn-secondary text-sm flex items-center gap-2 disabled:opacity-50"
                >
                  {logoutProvider === item.providerUrl ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
                  Logout
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {portalReady &&
        createPortal(
        <AnimatePresence>
          {showAdd && (
          <motion.div
            key="registry-add"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] overflow-y-auto modal-scrim flex min-h-full items-center justify-center p-4"
            onClick={() => setShowAdd(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.98 }}
              className="w-full max-w-3xl max-h-[88vh] overflow-y-auto relative overflow-hidden rounded-2xl glass-panel backdrop-blur-none p-5 sm:p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 mb-5">
                <div>
                  <h3 className="text-base font-semibold">Add Registry</h3>
                  <p className="text-xs text-muted-foreground mt-1">Verify credentials, then save to the server (encrypted).</p>
                </div>
                <button type="button" onClick={() => setShowAdd(false)} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mb-4">
                <label className="text-sm font-medium mb-1.5 block">Registry Type</label>
                <div className="rounded-lg border border-border bg-muted/60 p-2.5 dark:border-white/10 dark:bg-white/[0.03]">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => applyPreset(preset)}
                        className={`flex h-full min-h-[4.25rem] w-full min-w-0 flex-col items-center justify-center gap-1 text-center rounded-md border px-1 py-2 text-[0.7rem] leading-tight transition-colors sm:text-xs ${
                          presetId === preset.id
                            ? "border-primary/50 bg-primary/10 text-foreground dark:border-primary/60 dark:bg-primary/15"
                            : "border-border bg-background/80 text-muted-foreground hover:bg-muted hover:text-foreground dark:border-white/10 dark:bg-white/[0.02] dark:hover:bg-white/[0.06]"
                        }`}
                      >
                        <span className={REGISTRY_ICON_PICKER_WRAP}>
                          {preset.id === "dockerhub" ? (
                            <DockerHubLogoIcon className={REGISTRY_ICON_PICKER_INNER} />
                          ) : preset.id === "ghcr" ? (
                            <GitHubLogoIcon className={REGISTRY_ICON_PICKER_INNER} />
                          ) : preset.id === "gitlab" ? (
                            <GitLabLogoIcon className={REGISTRY_ICON_PICKER_INNER} />
                          ) : (
                            <Globe2 className={`${REGISTRY_ICON_PICKER_INNER} text-sky-500`} />
                          )}
                        </span>
                        <span className="line-clamp-2 w-full px-0.5">{preset.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">{PRESETS.find((p) => p.id === presetId)?.hint}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Registry URL</label>
                  <input className="input-field font-mono" value={providerUrl} onChange={(e) => setProviderUrl(e.target.value)} placeholder="docker.io or registry.example.com" autoComplete="off" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Username</label>
                  <input className="input-field" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" autoComplete="username" />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium mb-1.5 block">Password / Access Token</label>
                  <input type="password" className="input-field" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your PAT or registry password" autoComplete="new-password" />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={verifyConnection}
                  disabled={!canAuth || isVerifying || isLoggingIn}
                  className="btn-secondary text-sm border border-primary/35 text-primary flex items-center gap-2 disabled:opacity-50"
                >
                  {isVerifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Verify
                </button>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary text-sm">Cancel</button>
                  <button
                    type="button"
                    onClick={login}
                    disabled={!canAuth || isLoggingIn || isVerifying}
                    className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50"
                  >
                    {isLoggingIn ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />}
                    Save
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
        </AnimatePresence>,
        document.body,
        )}
    </>
  );
}
