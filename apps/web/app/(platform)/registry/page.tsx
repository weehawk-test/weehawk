"use client";

import { useMemo, useState } from "react";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { useBulkSelection } from "@/components/docker/useBulkSelection";
import { DockerBulkCheckbox } from "@/components/docker/DockerBulkCheckbox";
import {
  registryLoginApi,
  registryLogoutApi,
  registryVerifyApi,
  type RegistryLoginPayload,
} from "@/lib/registry-api";

type ProviderPreset = {
  id: string;
  name: string;
  providerUrl: string;
  hint: string;
};

const PRESETS: ProviderPreset[] = [
  {
    id: "dockerhub",
    name: "Docker Hub",
    providerUrl: "docker.io",
    hint: "Use your Docker Hub username + PAT/password.",
  },
  {
    id: "ghcr",
    name: "GitHub Container Registry",
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

type SavedRegistry = {
  id: string;
  name: string;
  providerUrl: string;
  username: string;
  lastVerifiedAt?: string;
};

const SAVED_KEY = "registry_saved_providers";

function loadSaved(): SavedRegistry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SAVED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedRegistry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSaved(items: SavedRegistry[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SAVED_KEY, JSON.stringify(items));
}

export default function RegistryPage() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [saved, setSaved] = useState<SavedRegistry[]>(loadSaved);
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
  const savedKeys = useMemo(() => filtered.map((s) => s.id), [filtered]);
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
      await registryLoginApi(buildPayload());
      const provider = providerUrl.trim();
      const user = username.trim();
      const autoName = provider;
      const prev = loadSaved();
      const next: SavedRegistry = {
        id: crypto.randomUUID(),
        name: autoName,
        providerUrl: provider,
        username: user,
        lastVerifiedAt: new Date().toISOString(),
      };
      const updated = [next, ...prev.filter((s) => s.providerUrl !== provider)].slice(
        0,
        10,
      );
      saveSaved(updated);
      setSaved(updated);
      toast({
        title: "Registry login successful",
        description: `Authenticated against ${providerUrl} and saved automatically.`,
      });
      setShowAdd(false);
      setPresetId("dockerhub");
      setProviderUrl("docker.io");
      setUsername("");
      setPassword("");
    } catch (e) {
      toast({
        title: "Login failed",
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

  const removeSaved = async (id: string, name: string) => {
    const ok = await confirm({
      title: "Remove saved registry?",
      description: `This removes "${name}" from saved profiles.`,
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!ok) return;
    const updated = saved.filter((s) => s.id !== id);
    setSaved(updated);
    saveSaved(updated);
    toast({ title: "Removed", description: name });
  };
  const removeSelected = async () => {
    const ids = savedBulk.selectedInFiltered;
    if (ids.length === 0) return;
    const ok = await confirm({
      title: "Remove selected registries?",
      description: `Remove ${ids.length} saved profile(s)?`,
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!ok) return;
    setIsBulkRemoving(true);
    try {
      const updated = saved.filter((s) => !ids.includes(s.id));
      setSaved(updated);
      saveSaved(updated);
      savedBulk.clear();
      toast({ title: "Removed", description: `${ids.length} profile(s) removed.` });
    } finally {
      setIsBulkRemoving(false);
    }
  };

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Registry</h1>
          <p className="text-muted-foreground">Manage container registry connections in one place.</p>
        </div>
        <button type="button" onClick={() => setShowAdd(true)} className="btn-primary flex items-center justify-center gap-2">
          <Plus className="w-5 h-5" /> Add registry
        </button>
      </div>

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

      {filtered.length === 0 ? (
        <div className="glass-panel backdrop-blur-none p-12 rounded-2xl flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
            <ShieldCheck className="w-10 h-10 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-bold mb-2">No connected registries yet</h3>
          <p className="text-muted-foreground mb-8 max-w-md">
            {search ? "No registries match your search." : "Add a registry to authenticate and save it for reuse."}
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
            <div key={item.id} className="glass-panel backdrop-blur-none rounded-2xl p-6 flex flex-col group interactive-card">
              <div className="flex justify-between items-start mb-4">
                <div className="min-w-0">
                  <h3 className="font-semibold text-lg leading-tight truncate">{item.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1 font-mono truncate">{item.providerUrl}</p>
                  <p className="text-xs text-muted-foreground mt-1">{item.username}</p>
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
                      savedBulk.selected.has(item.id) ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    <DockerBulkCheckbox
                      checked={savedBulk.selected.has(item.id)}
                      onCheckedChange={() => savedBulk.toggle(item.id)}
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

      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-y-0 left-64 right-0 z-50 bg-black/60 backdrop-blur-[3px] flex items-center justify-center p-4"
            onClick={() => setShowAdd(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.98 }}
              className="w-full max-w-3xl max-h-[88vh] overflow-y-auto glass-panel rounded-2xl border border-primary/25 p-5 sm:p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 mb-5">
                <div>
                  <h3 className="text-base font-semibold">Add Registry</h3>
                  <p className="text-xs text-muted-foreground mt-1">Choose provider, verify credentials, then login.</p>
                </div>
                <button type="button" onClick={() => setShowAdd(false)} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mb-4">
                <label className="text-sm font-medium mb-1.5 block">Registry Type</label>
                <select
                  value={presetId}
                  onChange={(e) => {
                    const selected = PRESETS.find((p) => p.id === e.target.value);
                    if (selected) applyPreset(selected);
                  }}
                  className="input-field"
                >
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
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
                    Login
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
