"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ShieldCheck,
  CheckCircle2,
  LogIn,
  Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  registryLoginApi,
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
  const sp = useSearchParams();
  const { toast } = useToast();
  const initialPreset = sp.get("preset") ?? "dockerhub";
  const initialProviderUrl = sp.get("providerUrl") ?? "docker.io";
  const initialUsername = sp.get("username") ?? "";
  const [presetId, setPresetId] = useState<string>(initialPreset);
  const [providerUrl, setProviderUrl] = useState<string>(initialProviderUrl);
  const [username, setUsername] = useState<string>(initialUsername);
  const [password, setPassword] = useState<string>("");
  const [lastAction, setLastAction] = useState<string>("No action yet");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const canAuth = providerUrl.trim() && username.trim() && password.trim();

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
      setLastAction(`Verified ${providerUrl} at ${new Date().toLocaleTimeString()}`);
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
      setLastAction(`Logged in to ${providerUrl} at ${new Date().toLocaleTimeString()}`);
      toast({
        title: "Registry login successful",
        description: `Authenticated against ${providerUrl} and saved automatically.`,
      });
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

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2 flex items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-primary" />
            Registry
          </h1>
          <p className="text-muted-foreground">
            Simple registry authentication and saved provider profiles.
          </p>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <Link href="/registry" className="btn-secondary text-sm">
          Add Registry
        </Link>
        <Link href="/registry/saved" className="btn-secondary text-sm">
          Connected Registries
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <section className="glass-panel rounded-2xl p-6 border border-primary/20">
          <div className="mb-5">
            <h2 className="text-lg font-semibold">Add Registry</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Choose a preset or custom, enter credentials, then verify/login.
            </p>
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
            <p className="text-xs text-muted-foreground mt-1.5">
              {PRESETS.find((p) => p.id === presetId)?.hint}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Registry URL</label>
              <input
                className="input-field font-mono"
                value={providerUrl}
                onChange={(e) => setProviderUrl(e.target.value)}
                placeholder="docker.io or registry.example.com"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Username</label>
              <input
                className="input-field"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
                autoComplete="username"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-sm font-medium mb-1.5 block">Password / Access Token</label>
              <input
                type="password"
                className="input-field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your PAT or registry password"
                autoComplete="new-password"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-6">
            <button
              type="button"
              onClick={verifyConnection}
              disabled={!canAuth || isVerifying}
              className="btn-secondary flex items-center gap-2 disabled:opacity-50"
            >
              {isVerifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Verify
            </button>
            <button
              type="button"
              onClick={login}
              disabled={!canAuth || isLoggingIn}
              className="btn-primary flex items-center gap-2 disabled:opacity-50 ml-auto"
            >
              {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              Login
            </button>
          </div>
        </section>
      </div>

    </>
  );
}
