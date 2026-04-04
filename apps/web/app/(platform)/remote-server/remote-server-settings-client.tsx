"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Plus, Server, Terminal, Trash2, PlugZap } from "lucide-react";
import { PublicKeyCopyBlock } from "@/components/remote-server/public-key-copy-block";
import { useAuth } from "@/contexts/auth-context";
import {
  createRemoteServerApi,
  deleteRemoteServerApi,
  fetchRemoteServers,
  generateRemoteSshKeypairApi,
  testRemoteServerApi,
  updateRemoteServerApi,
  type RemoteServerRow,
} from "@/lib/remote-servers-api";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { useToast } from "@/hooks/use-toast";

function emptyForm() {
  return {
    name: "",
    host: "",
    port: "22",
    sshUser: "",
    privateKey: "",
  };
}

type EditDraft = {
  name: string;
  host: string;
  port: string;
  sshUser: string;
  privateKeyReplace: string;
};

function emptyEditDraft(): EditDraft {
  return {
    name: "",
    host: "",
    port: "22",
    sshUser: "",
    privateKeyReplace: "",
  };
}

export function RemoteServerSettingsClient() {
  const { accessToken } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ["remote-servers"],
    queryFn: () => fetchRemoteServers(accessToken ?? ""),
    enabled: Boolean(accessToken),
  });

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [generatedPublicKey, setGeneratedPublicKey] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>(emptyEditDraft);

  useEffect(() => {
    if (editingId != null && list.data) {
      const row = list.data.find((r) => r.id === editingId);
      if (row) {
        setEditDraft({
          name: row.name,
          host: row.host,
          port: String(row.port),
          sshUser: row.sshUser,
          privateKeyReplace: "",
        });
      }
    }
  }, [editingId, list.data]);

  const generateMut = useMutation({
    mutationFn: (target: "create" | "edit") => generateRemoteSshKeypairApi(accessToken ?? ""),
    onSuccess: (data, target) => {
      setGeneratedPublicKey(data.publicKey);
      if (target === "edit") {
        setEditDraft((d) => ({ ...d, privateKeyReplace: data.privateKey }));
        toast({
          title: "Key pair generated",
          description: "Public key copied below; save to store the new private key encrypted.",
        });
      } else {
        setForm((f) => ({ ...f, privateKey: data.privateKey }));
        toast({
          title: "Key pair generated",
          description: "Copy the public key to the remote servers, then save the host.",
        });
      }
    },
    onError: (e: Error) =>
      toast({ title: "Generation failed", description: e.message, variant: "destructive" }),
  });

  const createMut = useMutation({
    mutationFn: () =>
      createRemoteServerApi(accessToken ?? "", {
        name: form.name.trim(),
        host: form.host.trim(),
        port: form.port.trim() ? Number(form.port) : 22,
        sshUser: form.sshUser.trim(),
        privateKey: form.privateKey.trim(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["remote-servers"] });
      setForm(emptyForm());
      setGeneratedPublicKey(null);
      setCreating(false);
      toast({ title: "Remote host saved" });
    },
    onError: (e: Error) =>
      toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: (row: RemoteServerRow) => {
      const patch: Parameters<typeof updateRemoteServerApi>[2] = {
        name: editDraft.name.trim(),
        host: editDraft.host.trim(),
        port: Number(editDraft.port) || 22,
        sshUser: editDraft.sshUser.trim(),
      };
      const pem = editDraft.privateKeyReplace.trim();
      if (pem) {
        patch.privateKey = pem;
      }
      return updateRemoteServerApi(accessToken ?? "", row.id, patch);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["remote-servers"] });
      setEditingId(null);
      toast({ title: "Updated" });
    },
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteRemoteServerApi(accessToken ?? "", id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["remote-servers"] });
      toast({ title: "Removed" });
    },
    onError: (e: Error) =>
      toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const testMut = useMutation({
    mutationFn: (id: number) => testRemoteServerApi(accessToken ?? "", id),
    onSuccess: (data, id) => {
      toast({
        title: data.success ? "Docker reachable" : "Connection failed",
        description: data.output.slice(0, 400) + (data.output.length > 400 ? "…" : ""),
        variant: data.success ? "default" : "destructive",
      });
      void id;
    },
    onError: (e: Error) =>
      toast({ title: "Test failed", description: e.message, variant: "destructive" }),
  });

  if (!accessToken) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  if (list.isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="size-6 animate-spin" />
        Loading…
      </div>
    );
  }

  if (list.isError) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-red-200 text-sm">
        {(list.error as Error).message}
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 border border-primary/20 p-2.5">
            <Server className="size-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Remote servers</h1>
            <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
              Paste an OpenSSH private key, or use <strong>Generate key pair</strong>. Keys are stored{" "}
              <strong>encrypted</strong> in the database.
            </p>
            <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed mt-1">
              Each host has an id: link a <strong>service</strong> to it with <code className="text-foreground/80">remoteServerId</code>.
              Use <strong>Console</strong> to open the full WeeDocker UI for that host (containers, images, networks, volumes, services).
            </p>
          </div>
        </div>
      </header>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Hosts</h2>
          {!creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/25 text-primary hover:bg-primary/15"
            >
              <Plus className="size-3.5" />
              Add host
            </button>
          )}
        </div>

        {creating && (
          <div className="glass-panel rounded-xl p-5 space-y-3 border border-white/10">
            <p className="text-xs text-muted-foreground">New remote Docker host</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={generateMut.isPending}
                onClick={() => generateMut.mutate("create")}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 text-violet-200 hover:bg-violet-500/15 disabled:opacity-50"
              >
                {generateMut.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <KeyRound className="size-3.5" />
                )}
                Generate key pair
              </button>
            </div>
            {generatedPublicKey ? <PublicKeyCopyBlock publicKey={generatedPublicKey} /> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 block">
                <span className="text-xs text-muted-foreground">Label</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder="Production"
                />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs text-muted-foreground">Host / IP</span>
                <input
                  value={form.host}
                  onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder="203.0.113.10"
                />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs text-muted-foreground">SSH port</span>
                <input
                  value={form.port}
                  onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder="22"
                />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs text-muted-foreground">SSH user</span>
                <input
                  value={form.sshUser}
                  onChange={(e) => setForm((f) => ({ ...f, sshUser: e.target.value }))}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder="deploy"
                />
              </label>
              <label className="space-y-1 block sm:col-span-2">
                <span className="text-xs text-muted-foreground">Private key (PEM)</span>
                <textarea
                  value={form.privateKey}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, privateKey: e.target.value }));
                    setGeneratedPublicKey(null);
                  }}
                  className="w-full min-h-[140px] rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs font-mono"
                  placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n..."}
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={createMut.isPending}
                onClick={() => createMut.mutate()}
                className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/25 text-emerald-400"
              >
                {createMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setForm(emptyForm());
                  setGeneratedPublicKey(null);
                }}
                className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-muted-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {(list.data ?? []).length === 0 && !creating ? (
            <p className="text-sm text-muted-foreground py-8 text-center border border-dashed border-white/10 rounded-xl">
              No remote hosts yet. Add a host and paste a private key, or generate a new pair.
            </p>
          ) : (
            (list.data ?? []).map((row) => (
              <div
                key={row.id}
                className="glass-panel rounded-xl border border-white/10 overflow-hidden"
              >
                {editingId === row.id ? (
                  <div className="p-5 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={generateMut.isPending}
                        onClick={() => generateMut.mutate("edit")}
                        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 text-violet-200 hover:bg-violet-500/15 disabled:opacity-50"
                      >
                        {generateMut.isPending ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <KeyRound className="size-3.5" />
                        )}
                        Generate new key pair
                      </button>
                      <span className="text-[11px] text-muted-foreground">
                        Fills “replace” below; save to store the new private key
                      </span>
                    </div>
                    {generatedPublicKey && editingId === row.id ? (
                      <PublicKeyCopyBlock publicKey={generatedPublicKey} />
                    ) : null}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1 block">
                        <span className="text-xs text-muted-foreground">Label</span>
                        <input
                          value={editDraft.name}
                          onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                          className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="space-y-1 block">
                        <span className="text-xs text-muted-foreground">Host</span>
                        <input
                          value={editDraft.host}
                          onChange={(e) => setEditDraft((d) => ({ ...d, host: e.target.value }))}
                          className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="space-y-1 block">
                        <span className="text-xs text-muted-foreground">SSH port</span>
                        <input
                          value={editDraft.port}
                          onChange={(e) => setEditDraft((d) => ({ ...d, port: e.target.value }))}
                          className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="space-y-1 block">
                        <span className="text-xs text-muted-foreground">SSH user</span>
                        <input
                          value={editDraft.sshUser}
                          onChange={(e) => setEditDraft((d) => ({ ...d, sshUser: e.target.value }))}
                          className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm"
                        />
                      </label>
                      {row.authMode === "file" ? (
                        <p className="text-xs text-muted-foreground sm:col-span-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                          Legacy: key file on API host at{" "}
                          <code className="text-[11px] break-all">{row.privateKeyPath}</code>. Paste a new private key below
                          to migrate to encrypted storage.
                        </p>
                      ) : null}
                      <label className="space-y-1 block sm:col-span-2">
                        <span className="text-xs text-muted-foreground">
                          Replace private key (optional PEM)
                        </span>
                        <textarea
                          value={editDraft.privateKeyReplace}
                          onChange={(e) => {
                            setEditDraft((d) => ({ ...d, privateKeyReplace: e.target.value }));
                            if (!e.target.value.trim()) {
                              setGeneratedPublicKey(null);
                            }
                          }}
                          className="w-full min-h-[100px] rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs"
                          placeholder="Leave empty to keep current key, or paste / generate a new one"
                          spellCheck={false}
                          autoComplete="off"
                        />
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={updateMut.isPending}
                        onClick={() => updateMut.mutate(row)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/25 text-emerald-400"
                      >
                        {updateMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(null);
                          setGeneratedPublicKey(null);
                        }}
                        className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-muted-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 py-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm truncate">{row.name}</p>
                        <span
                          className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border ${
                            row.authMode === "stored"
                              ? "border-emerald-500/30 text-emerald-400/90 bg-emerald-500/10"
                              : row.authMode === "file"
                                ? "border-zinc-500/30 text-zinc-400 bg-zinc-500/10"
                                : "border-amber-500/30 text-amber-400/90 bg-amber-500/10"
                          }`}
                        >
                          {row.authMode === "stored"
                            ? "DB encrypted"
                            : row.authMode === "file"
                              ? "Legacy file"
                              : "No key"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono mt-1 truncate">
                        {row.sshUser}@{row.host}
                        {row.port !== 22 ? `:${row.port}` : ""}
                      </p>
                      {row.authMode === "file" && row.privateKeyPath ? (
                        <p className="text-[11px] text-zinc-500 font-mono mt-1 truncate break-all">
                          {row.privateKeyPath}
                        </p>
                      ) : row.authMode === "stored" ? (
                        <p className="text-[11px] text-zinc-500 mt-1">Private key stored encrypted</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {row.hasPrivateKey ? (
                        <Link
                          href={`/console/${row.id}/containers`}
                          scroll={false}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-white/10 hover:bg-white/5"
                          title="Open WeeDocker console for this host (full Docker UI)"
                        >
                          <Terminal className="size-3.5" />
                          Console
                        </Link>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-white/10 opacity-40 cursor-not-allowed"
                          title="Configure a private key first"
                        >
                          <Terminal className="size-3.5" />
                          Console
                        </span>
                      )}
                      <button
                        type="button"
                        disabled={testMut.isPending}
                        onClick={() => testMut.mutate(row.id)}
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-white/10 hover:bg-white/5"
                        title="Check SSH and remote Docker API (Dockerode over SSH from the API)"
                      >
                        {testMut.isPending ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <PlugZap className="size-3.5" />
                        )}
                        Test
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setGeneratedPublicKey(null);
                          setEditingId(row.id);
                        }}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-white/10 hover:bg-white/5"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={deleteMut.isPending}
                        onClick={async () => {
                          const ok = await confirm({
                            title: `Delete remote host “${row.name}”?`,
                            description:
                              "This removes the stored host and encrypted key. Services using this host may fail until you add a replacement.",
                            confirmLabel: "Delete host",
                            cancelLabel: "Cancel",
                            variant: "destructive",
                          });
                          if (!ok) return;
                          deleteMut.mutate(row.id);
                        }}
                        className="text-xs p-1.5 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

      </div>
    </div>
  );
}
