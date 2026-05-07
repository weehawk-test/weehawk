"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, FlaskConical, Globe2, Loader2, Pencil, Plus, Search, Shield, Trash2, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useOrgWorkspace } from "@/(platform)/org-workspace/org-workspace-context";
import { orgScopedQuerySegment } from "@/lib/react-query-scope";
import { fetchRemoteServers } from "@/lib/remote-servers-api";
import { ListPagination } from "@/components/docker/ListPagination";
import { useBulkSelection } from "@/components/docker/useBulkSelection";
import { DockerBulkCheckbox } from "@/components/docker/DockerBulkCheckbox";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import {
  deleteRegistryAccountApi,
  fetchRegistryAccounts,
  testSavedRegistryAccountApi,
  updateRegistryAccountApi,
  type RegistryAccountRow,
} from "@/lib/registry-api";
import {
  orgMemberAllowsRegistryAdd,
  orgMemberAllowsRegistryDelete,
  orgMemberAllowsRegistryEdit,
  orgMemberAllowsRegistryTest,
} from "@/lib/org-workspace-permissions";

function providerLabel(providerUrl: string): string {
  const p = providerUrl.toLowerCase();
  if (p === "docker.io") return "Docker Hub";
  if (p === "ghcr.io") return "GitHub Registry";
  if (p === "registry.gitlab.com") return "GitLab Registry";
  return "Custom Registry";
}

function formatDateUTC(dateInput: string): string {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return dateInput;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

export function RegistryClient({
  initialAccounts,
  initialError,
}: {
  initialAccounts: RegistryAccountRow[];
  initialError: string | null;
}) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();
  const org = useOrgWorkspace();
  const orgPid = org.publicId.trim();
  const canRegistryAdd = orgMemberAllowsRegistryAdd(org.workspacePermissions);
  const canRegistryDelete = orgMemberAllowsRegistryDelete(org.workspacePermissions);
  const canRegistryEdit = orgMemberAllowsRegistryEdit(org.workspacePermissions);
  const canRegistryTest = orgMemberAllowsRegistryTest(org.workspacePermissions);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [showTestModal, setShowTestModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [testServerRef, setTestServerRef] = useState("");
  const [editTarget, setEditTarget] = useState<{
    publicId: string;
    name: string;
    providerUrl: string;
    username: string;
  } | null>(null);
  const [editName, setEditName] = useState("");
  const [editProviderUrl, setEditProviderUrl] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const PAGE_SIZE = 9;

  const accountsQ = useQuery({
    queryKey: ["registry-accounts", orgScopedQuerySegment(orgPid)],
    queryFn: () => fetchRegistryAccounts(accessToken ?? ""),
    enabled: Boolean(accessToken && orgPid),
    initialData: initialAccounts,
    refetchOnMount: "always",
  });

  const filteredAccounts = useMemo(() => {
    const list = [...(accountsQ.data ?? [])].sort((a, b) => b.id - a.id);
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((a) =>
      [a.name, a.providerUrl, a.username].some((v) => v.toLowerCase().includes(q)),
    );
  }, [accountsQ.data, search]);
  const total = filteredAccounts.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedAccounts = useMemo(() => {
    const from = (safePage - 1) * PAGE_SIZE;
    return filteredAccounts.slice(from, from + PAGE_SIZE);
  }, [filteredAccounts, safePage]);
  const cardKeys = useMemo(
    () => pagedAccounts.map((a) => String(a.publicId || a.id)),
    [pagedAccounts],
  );
  const bulk = useBulkSelection(cardKeys);
  const remoteServersQ = useQuery({
    queryKey: ["remote-servers", orgScopedQuerySegment(orgPid)],
    queryFn: () => fetchRemoteServers(accessToken ?? ""),
    enabled: Boolean(accessToken && orgPid),
    staleTime: 120_000,
  });
  const deployServers = useMemo(
    () => (remoteServersQ.data ?? []).filter((s) => s.serverRole === "deploy"),
    [remoteServersQ.data],
  );

  const providerIcon = (providerUrl: string) => {
    const p = providerUrl.toLowerCase();
    if (p === "docker.io") return <img src="/registry/docker-hub.svg" alt="" className="h-8 w-8 object-contain" />;
    if (p === "ghcr.io") return <img src="/deployment-sources/github.svg" alt="" className="h-8 w-8 object-contain dark:invert" />;
    if (p === "registry.gitlab.com") return <img src="/deployment-sources/gitlab.svg" alt="" className="h-8 w-8 object-contain" />;
    return <Globe2 className="w-5 h-5 text-primary" />;
  };

  const removeAccount = async (publicId: string) => {
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
  const runTest = async () => {
    if (!accessToken || !testingId) return;
    if (!testServerRef) {
      toast({ title: "Missing fields", description: "Select deploy host.", variant: "destructive" });
      return;
    }
    try {
      setIsTesting(true);
      const out = await testSavedRegistryAccountApi(
        accessToken,
        testingId,
        testServerRef,
      );
      if (!out.success) throw new Error(out.output || "Test failed");
      toast({ title: "Test succeeded", description: "Registry credentials are valid on selected host." });
      setShowTestModal(false);
      setTestServerRef("");
      setTestingId(null);
    } catch (e) {
      toast({ title: "Test failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setIsTesting(false);
    }
  };
  const openEdit = (acc: { publicId: string; name: string; providerUrl: string; username: string }) => {
    setEditTarget(acc);
    setEditName(acc.name);
    setEditProviderUrl(acc.providerUrl);
    setEditUsername(acc.username);
    setEditPassword("");
    setShowEditModal(true);
  };
  const saveEdit = async () => {
    if (!accessToken || !orgPid || !editTarget) return;
    setIsEditing(true);
    try {
      await updateRegistryAccountApi(accessToken, editTarget.publicId, {
        name: editName.trim(),
        providerUrl: editProviderUrl.trim(),
        username: editUsername.trim(),
        ...(editPassword.trim() ? { password: editPassword } : {}),
      });
      await queryClient.invalidateQueries({
        queryKey: ["registry-accounts", orgScopedQuerySegment(orgPid)],
      });
      toast({ title: "Registry account updated" });
      setShowEditModal(false);
      setEditTarget(null);
    } catch (e) {
      toast({ title: "Update failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setIsEditing(false);
    }
  };
  const handleDeleteOne = async (publicId: string, displayName: string) => {
    const ok = await confirm({
      title: "Delete registry account?",
      description: `“${displayName}” will be removed.`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    await removeAccount(publicId);
  };
  const handleBulkDelete = async () => {
    const ids = bulk.selectedInFiltered;
    if (ids.length === 0) return;
    const ok = await confirm({
      title: "Delete selected registry accounts?",
      description: `Delete ${ids.length} account(s)?`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    for (const id of ids) {
      await removeAccount(id);
    }
    bulk.clear();
  };

  return (
    <div className="w-full pb-10">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Registry</h1>
          <p className="mt-1 text-muted-foreground">
            Manage registry accounts. Verify and store credentials for image pull/push.
          </p>
        </div>
        <Link
          href="/registry/create"
          aria-disabled={!canRegistryAdd}
          className={`btn-primary inline-flex items-center gap-2 shrink-0 ${
            !canRegistryAdd ? "pointer-events-none opacity-50" : ""
          }`}
        >
          <Plus className="w-4 h-4" />
          Add Registry
        </Link>
      </div>

      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            className="input-field !pl-10 w-full bg-card/50"
            placeholder="Search registries..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {pagedAccounts.length > 0 && (
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <DockerBulkCheckbox
                checked={bulk.allSelected ? true : bulk.someSelected ? "indeterminate" : false}
                onCheckedChange={() => bulk.toggleAllFiltered()}
                aria-label="Select all registries on this page"
              />
              <span className="text-sm text-muted-foreground">
                Select all on this page ({pagedAccounts.length})
              </span>
            </div>
            {bulk.selectedInFiltered.length > 0 && (
              <button
                type="button"
                onClick={() => void handleBulkDelete()}
                disabled={Boolean(deletingId) || !canRegistryDelete}
                className="btn-secondary border-destructive/40 text-destructive hover:bg-destructive/10 flex items-center gap-2 text-sm"
              >
                <Trash2 className="w-4 h-4" />
                Delete ({bulk.selectedInFiltered.length})
              </button>
            )}
          </div>
        )}
      </div>

      <div className="min-h-[340px]">
        {accountsQ.isPending && initialAccounts.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading registries...
          </div>
        ) : accountsQ.isError && filteredAccounts.length === 0 ? (
          <p className="text-sm text-destructive">
            {initialError ?? (accountsQ.error instanceof Error ? accountsQ.error.message : String(accountsQ.error))}
          </p>
        ) : filteredAccounts.length === 0 ? (
          <div className="glass-panel backdrop-blur-none rounded-2xl p-6 min-h-[340px]">
            <div className="h-full min-h-[280px] flex flex-col items-center justify-center text-center">
              <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
                <Shield className="w-10 h-10 text-muted-foreground" />
              </div>
              <h3 className="text-3xl font-semibold mb-2">No registries configured</h3>
              <p className="text-muted-foreground mb-8 max-w-md">
                Add your first registry account to start using private images.
              </p>
              <Link href="/registry/create" className="btn-primary inline-flex items-center gap-2">
                <Plus className="w-4 h-4" />
                Add Registry
              </Link>
            </div>
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {pagedAccounts.map((acc) => (
              <li key={acc.publicId} className="glass-panel backdrop-blur-none rounded-2xl p-6 flex flex-col group interactive-card">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                      {providerIcon(acc.providerUrl)}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-lg leading-tight truncate">
                        {acc.name}
                      </h3>
                      <p className="text-sm text-muted-foreground mt-1 truncate">{providerLabel(acc.providerUrl)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                    <button
                      type="button"
                      className="p-2 rounded-md hover:bg-destructive/20 text-destructive transition-colors opacity-0 group-hover:opacity-100 disabled:pointer-events-none disabled:opacity-30"
                      onClick={() => void handleDeleteOne(acc.publicId, acc.name || providerLabel(acc.providerUrl))}
                      disabled={Boolean(deletingId) || !canRegistryDelete}
                      title="Delete"
                    >
                      {deletingId === acc.publicId ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                    <div
                      className={`transition-opacity ${
                        bulk.selected.has(String(acc.publicId || acc.id))
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100"
                      }`}
                    >
                      <DockerBulkCheckbox
                        checked={bulk.selected.has(String(acc.publicId || acc.id))}
                        onCheckedChange={() => bulk.toggle(String(acc.publicId || acc.id))}
                        aria-label={`Select registry ${acc.name}`}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2 text-sm text-muted-foreground mb-4">
                  <p className="font-mono truncate">Registry: {acc.providerUrl}</p>
                  <p className="font-mono truncate">Username: {acc.username}</p>
                </div>

                <div className="mt-auto pt-4 border-t border-white/5 flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-1 min-w-0">
                    <Clock className="w-3 h-3 shrink-0" />
                    <span
                      className="truncate"
                      title={acc.createdAt ? `Created (UTC) ${formatDateUTC(acc.createdAt)}` : "Created date unavailable"}
                    >
                      {acc.createdAt ? formatDateUTC(acc.createdAt) : "Unknown date"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => openEdit(acc)}
                      disabled={!canRegistryEdit}
                      className="text-primary hover:underline cursor-pointer font-medium flex items-center gap-1 text-xs disabled:pointer-events-none disabled:opacity-50"
                    >
                      <Pencil className="w-3 h-3" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTestingId(acc.publicId);
                        setShowTestModal(true);
                      }}
                      disabled={!canRegistryTest}
                      className="text-primary hover:underline cursor-pointer font-medium flex items-center gap-1 text-xs disabled:pointer-events-none disabled:opacity-50"
                    >
                      <FlaskConical className="w-3 h-3" />
                      Test
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {!accountsQ.isPending && !accountsQ.isError && filteredAccounts.length > 0 ? (
          <ListPagination
            page={safePage}
            totalPages={totalPages}
            onPageChange={(next) => setPage(Math.max(1, Math.min(totalPages, next)))}
            from={(safePage - 1) * PAGE_SIZE + 1}
            to={Math.min(safePage * PAGE_SIZE, total)}
            total={total}
            className="mt-5"
          />
        ) : null}
      </div>
      {showTestModal && testingId ? (
        <div className="fixed inset-0 z-[80] overflow-y-auto modal-scrim flex items-center justify-center p-4" onClick={() => {
          if (isTesting) return;
          setShowTestModal(false);
        }}>
          <div className="w-full max-w-xl glass-panel rounded-2xl border border-primary/25 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-semibold">Test registry</h3>
              <button type="button" onClick={() => setShowTestModal(false)} disabled={isTesting} className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-50">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Run test from</label>
                <select className="input-field text-sm" value={testServerRef} onChange={(e) => setTestServerRef(e.target.value)}>
                  <option value="">Select a deploy host...</option>
                  {deployServers.map((srv) => (
                    <option key={srv.id} value={String(srv.publicId ?? srv.id)}>
                      {srv.name} ({srv.host})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setShowTestModal(false)} disabled={isTesting}>Cancel</button>
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
                onClick={() => void runTest()}
                disabled={isTesting || !testServerRef}
              >
                {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
                {isTesting ? "Testing..." : "Test"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showEditModal && editTarget ? (
        <div className="fixed inset-0 z-[80] overflow-y-auto modal-scrim flex items-center justify-center p-4" onClick={() => setShowEditModal(false)}>
          <div className="w-full max-w-xl glass-panel rounded-2xl border border-primary/25 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-semibold">Edit registry</h3>
              <button type="button" onClick={() => setShowEditModal(false)} className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Name</label>
                <input className="input-field" value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Registry URL</label>
                <input className="input-field font-mono" value={editProviderUrl} onChange={(e) => setEditProviderUrl(e.target.value)} />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Username</label>
                <input className="input-field" value={editUsername} onChange={(e) => setEditUsername(e.target.value)} />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Password / Token (optional new)</label>
                <input type="password" className="input-field" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setShowEditModal(false)}>Cancel</button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void saveEdit()}
                disabled={isEditing || !canRegistryEdit}
              >
                {isEditing ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

