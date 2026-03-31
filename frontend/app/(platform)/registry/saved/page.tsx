"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, LogOut, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { registryLogoutApi } from "@/lib/registry-api";

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

export default function RegistrySavedPage() {
  const { toast } = useToast();
  const [saved, setSaved] = useState<SavedRegistry[]>(loadSaved);
  const [logoutProvider, setLogoutProvider] = useState<string | null>(null);

  const removeSaved = (id: string) => {
    const updated = saved.filter((s) => s.id !== id);
    setSaved(updated);
    saveSaved(updated);
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

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Connected Registries</h1>
          <p className="text-muted-foreground">Save and manage reusable registry provider profiles.</p>
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

      <section className="glass-panel rounded-2xl p-6 border border-white/10">
        {saved.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No logged-in registries yet. Login from Add Registry and it will appear here automatically.
          </p>
        ) : (
          <div className="space-y-2">
            {saved.map((item) => (
              <div key={item.id} className="rounded-xl border border-white/10 p-3">
                <Link
                  href={`/registry?preset=custom&providerUrl=${encodeURIComponent(
                    item.providerUrl,
                  )}&username=${encodeURIComponent(item.username)}`}
                  className="block"
                >
                  <p className="font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{item.providerUrl}</p>
                  <p className="text-xs text-muted-foreground">{item.username}</p>
                </Link>
                <div className="flex justify-end mt-2">
                  <button
                    type="button"
                    onClick={() => logoutSaved(item.providerUrl)}
                    disabled={logoutProvider === item.providerUrl}
                    className="p-1.5 rounded-md hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
                    title="Logout from this provider"
                  >
                    {logoutProvider === item.providerUrl ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <LogOut className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSaved(item.id)}
                    className="p-1.5 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                    title="Remove saved profile"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
