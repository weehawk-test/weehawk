"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Globe2, Loader2, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useOrgWorkspace } from "@/(platform)/org-workspace/org-workspace-context";
import { orgScopedQuerySegment } from "@/lib/react-query-scope";
import { deleteRegistryAccountApi, fetchRegistryAccounts } from "@/lib/registry-api";
import { RegistryBreadcrumb } from "../_components/registry-breadcrumb";

function providerLabel(providerUrl: string): string {
  const p = providerUrl.toLowerCase();
  if (p === "docker.io") return "Docker Hub";
  if (p === "ghcr.io") return "GitHub Registry";
  if (p === "registry.gitlab.com") return "GitLab Registry";
  return "Custom Registry";
}

function providerIcon(providerUrl: string) {
  const p = providerUrl.toLowerCase();
  if (p === "docker.io") {
    return <img src="/registry/docker-hub.svg" alt="" className="h-8 w-8 object-contain" />;
  }
  if (p === "ghcr.io") {
    return <img src="/deployment-sources/github.svg" alt="" className="h-8 w-8 object-contain dark:invert" />;
  }
  if (p === "registry.gitlab.com") {
    return <img src="/deployment-sources/gitlab.svg" alt="" className="h-8 w-8 object-contain" />;
  }
  return <Globe2 className="h-8 w-8 text-sky-500" />;
}

export default function RegistrySavedPage() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const orgPid = useOrgWorkspace().publicId.trim();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const accountsQ = useQuery({
    queryKey: ["registry-accounts", orgScopedQuerySegment(orgPid)],
    queryFn: () => fetchRegistryAccounts(accessToken ?? ""),
    enabled: Boolean(accessToken && orgPid),
  });

  const grouped = useMemo(() => {
    const items = accountsQ.data ?? [];
    const sorted = [...items].sort((a, b) => {
      const providerCmp = a.providerUrl.localeCompare(b.providerUrl, "en");
      if (providerCmp !== 0) return providerCmp;
      return a.name.localeCompare(b.name, "en");
    });
    const query = q.trim().toLowerCase();
    if (!query) return sorted;
    return sorted.filter((acc) =>
      [acc.name, acc.providerUrl, acc.username].some((v) => v.toLowerCase().includes(query)),
    );
  }, [accountsQ.data, q]);

  const remove = async (publicId: string) => {
    if (!accessToken || !orgPid) return;
    setDeletingId(publicId);
    try {
      await deleteRegistryAccountApi(accessToken, publicId);
      await queryClient.invalidateQueries({
        queryKey: ["registry-accounts", orgScopedQuerySegment(orgPid)],
      });
      toast({ title: "Registry account removed" });
    } catch (e) {
      toast({
        title: "Could not remove account",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="w-full space-y-8 pb-12">
      <RegistryBreadcrumb current="saved" />

      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">Saved Registry Accounts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          All registry credentials stored for this organization. You can save multiple accounts for the same provider.
        </p>
      </div>

      <div className="mb-2">
        <div className="relative min-w-[220px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            className="input-field !pl-10 w-full bg-card/50"
            placeholder="Search accounts..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-6 md:p-8 space-y-4">
        {accountsQ.isPending ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading saved accounts...
          </div>
        ) : accountsQ.isError ? (
          <p className="text-sm text-destructive">
            {accountsQ.error instanceof Error ? accountsQ.error.message : String(accountsQ.error)}
          </p>
        ) : grouped.length === 0 ? (
          <div className="glass-panel backdrop-blur-none p-10 rounded-2xl flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
              <Bell className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-bold mb-2">No saved registry accounts</h3>
            <p className="text-muted-foreground mb-6 max-w-md text-sm">
              Add your first registry account, then it will appear here for quick management.
            </p>
            <Link href="/registry" className="btn-primary">
              Add registry account
            </Link>
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {grouped.map((acc) => (
              <li key={acc.publicId} className="glass-panel backdrop-blur-none rounded-2xl p-5 flex flex-col gap-4 interactive-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                      {providerIcon(acc.providerUrl)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{acc.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{providerLabel(acc.providerUrl)}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5 text-xs text-muted-foreground font-mono">
                  <p className="truncate" title={acc.providerUrl}>Provider: {acc.providerUrl}</p>
                  <p className="truncate" title={acc.username}>Username: {acc.username}</p>
                </div>

                <div className="mt-auto pt-3 border-t border-white/5 flex items-center justify-end">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/15 disabled:opacity-50"
                    onClick={() => void remove(acc.publicId)}
                    disabled={Boolean(deletingId)}
                  >
                    {deletingId === acc.publicId ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Link href="/registry" className="btn-secondary">
          Back to registry providers
        </Link>
      </div>
    </div>
  );
}
