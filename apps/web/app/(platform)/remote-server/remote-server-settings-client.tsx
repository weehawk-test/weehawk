"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Container,
  KeyRound,
  Loader2,
  Plus,
  Server,
  Terminal,
  Trash2,
  PlugZap,
  FlaskConical,
  X,
} from "lucide-react";
import { PublicKeyCopyBlock } from "@/components/remote-server/public-key-copy-block";
import { RemoteServerInstallBlock } from "@/components/remote-server/remote-server-install-block";
import { useAuth } from "@/contexts/auth-context";
import {
  createRemoteServerApi,
  deleteRemoteServerApi,
  fetchRemoteServers,
  localTerminalWsUrl,
  generateRemoteSshKeypairApi,
  remoteTerminalWsUrl,
  testRemoteServerApi,
  testRemoteServerSshApi,
  updateRemoteServerApi,
  type RemoteServerRow,
  type RemoteServerRole,
} from "@/lib/remote-servers-api";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { useToast } from "@/hooks/use-toast";
import { isCloudEdition } from "@/lib/weehawk-edition";
import { isLoopbackSshHost } from "@/lib/loopback-ssh-host";

function emptyForm() {
  return {
    name: "",
    host: "",
    port: "22",
    sshUser: "",
    publicIpv4: "",
    privateKey: "",
    serverRole: "deploy" as RemoteServerRole,
  };
}

type EditDraft = {
  name: string;
  host: string;
  port: string;
  sshUser: string;
  publicIpv4: string;
  privateKeyReplace: string;
  serverRole: RemoteServerRole;
};

function emptyEditDraft(): EditDraft {
  return {
    name: "",
    host: "",
    port: "22",
    sshUser: "",
    publicIpv4: "",
    privateKeyReplace: "",
    serverRole: "deploy",
  };
}

export function RemoteServerSettingsClient() {
  const hideLocalDockerHost = isCloudEdition();
  const { accessToken, user } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const remoteServersQueryKey = ["remote-servers"] as const;

  const list = useQuery({
    queryKey: remoteServersQueryKey,
    queryFn: () => fetchRemoteServers(accessToken ?? ""),
    enabled: Boolean(accessToken),
  });

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [generatedPublicKey, setGeneratedPublicKey] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>(emptyEditDraft);
  const [testModalRow, setTestModalRow] = useState<RemoteServerRow | null>(null);
  const [terminalModalRow, setTerminalModalRow] = useState<RemoteServerRow | null>(null);
  const [localTerminalOpen, setLocalTerminalOpen] = useState(false);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalFailureNotifiedRef = useRef(false);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [terminalConnecting, setTerminalConnecting] = useState(false);

  useEffect(() => {
    if (editingId != null && list.data) {
      const row = list.data.find((r) => r.id === editingId);
      if (row) {
        setEditDraft({
          name: row.name,
          host: row.host,
          port: String(row.port),
          sshUser: row.sshUser,
          publicIpv4: row.publicIpv4 ?? "",
          privateKeyReplace: "",
          serverRole: row.serverRole,
        });
      }
    }
  }, [editingId, list.data]);

  useEffect(() => {
    if (creating && isLoopbackSshHost(form.host)) {
      setForm((f) => (f.serverRole !== "build" ? { ...f, serverRole: "build" } : f));
    }
  }, [creating, form.host]);

  useEffect(() => {
    if (editingId != null && isLoopbackSshHost(editDraft.host)) {
      setEditDraft((d) => (d.serverRole !== "build" ? { ...d, serverRole: "build" } : d));
    }
  }, [editingId, editDraft.host]);

  useEffect(() => {
    if (editingId == null || list.data == null) return;
    if (!list.data.some((r) => r.id === editingId)) {
      setEditingId(null);
      setGeneratedPublicKey(null);
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
        serverRole: form.serverRole,
        ...(form.publicIpv4.trim() ? { publicIpv4: form.publicIpv4.trim() } : {}),
      }),
    onSuccess: (created) => {
      qc.setQueryData<RemoteServerRow[]>(remoteServersQueryKey, (prev) => {
        const rows = prev ?? [];
        if (rows.some((r) => r.id === created.id)) return rows;
        return [created, ...rows];
      });
      qc.invalidateQueries({ queryKey: remoteServersQueryKey });
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
        serverRole: editDraft.serverRole,
        publicIpv4: editDraft.publicIpv4.trim() ? editDraft.publicIpv4.trim() : null,
      };
      const pem = editDraft.privateKeyReplace.trim();
      if (pem) {
        patch.privateKey = pem;
      }
      return updateRemoteServerApi(accessToken ?? "", row.id, patch);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: remoteServersQueryKey });
      setEditingId(null);
      toast({ title: "Updated" });
    },
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteRemoteServerApi(accessToken ?? "", id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: remoteServersQueryKey });
      toast({ title: "Removed" });
    },
    onError: (e: Error) =>
      toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  function dismissCreateHostModal() {
    setCreating(false);
    setForm(emptyForm());
    setGeneratedPublicKey(null);
  }

  function dismissEditHostModal() {
    setEditingId(null);
    setGeneratedPublicKey(null);
  }

  const testMut = useMutation({
    mutationFn: (id: number) => testRemoteServerApi(accessToken ?? "", id),
    onSuccess: (data, id) => {
      toast({
        title: data.success ? "Docker reachable" : "Connection failed",
        description: data.output.slice(0, 900) + (data.output.length > 900 ? "…" : ""),
        variant: data.success ? "default" : "destructive",
      });
      void id;
    },
    onError: (e: Error) =>
      toast({ title: "Test failed", description: e.message, variant: "destructive" }),
  });

  const testSshMut = useMutation({
    mutationFn: (id: number) => testRemoteServerSshApi(accessToken ?? "", id),
    onSuccess: (data) => {
      toast({
        title: data.success ? "SSH OK" : "SSH failed",
        description: data.output.slice(0, 900) + (data.output.length > 900 ? "…" : ""),
        variant: data.success ? "default" : "destructive",
      });
    },
    onError: (e: Error) =>
      toast({ title: "SSH test failed", description: e.message, variant: "destructive" }),
  });
  useEffect(() => {
    const row = terminalModalRow;
    const open = localTerminalOpen || row != null;
    const el = terminalContainerRef.current;
    if (!open || !el) return;

    let disposed = false;
    let ws: WebSocket | null = null;
    let term: import("@xterm/xterm").Terminal | null = null;
    let fit: import("@xterm/addon-fit").FitAddon | null = null;
    let ro: ResizeObserver | null = null;
    const textEnc = new TextEncoder();

    const pushResize = () => {
      if (disposed || !ws || ws.readyState !== WebSocket.OPEN || !term) return;
      try {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      } catch {
        /* ignore */
      }
    };
    const onResize = () => {
      try {
        fit?.fit();
        pushResize();
      } catch {
        /* ignore */
      }
    };

    void (async () => {
      terminalFailureNotifiedRef.current = false;
      setTerminalError(null);
      setTerminalConnecting(true);
      el.innerHTML = "";
      const { Terminal: XTerm } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      await import("@xterm/xterm/css/xterm.css");
      if (disposed) return;

      const t = new XTerm({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        theme: { background: "#09090b", foreground: "#e4e4e7" },
      });
      const fa = new FitAddon();
      t.loadAddon(fa);
      t.open(el);
      fa.fit();
      term = t;
      fit = fa;

      window.addEventListener("resize", onResize);
      ro = new ResizeObserver(onResize);
      ro.observe(el);

      ws = new WebSocket(row ? remoteTerminalWsUrl(row.id) : localTerminalWsUrl());
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        if (disposed) return;
        setTerminalConnecting(false);
        fa.fit();
        pushResize();
        t.focus();
      };
      ws.onmessage = (ev: MessageEvent<string | ArrayBuffer>) => {
        if (disposed) return;
        if (typeof ev.data === "string") {
          try {
            const j = JSON.parse(ev.data) as { type?: string; message?: string };
            if (j.type === "error" && j.message) {
              setTerminalError(j.message);
              if (!terminalFailureNotifiedRef.current) {
                terminalFailureNotifiedRef.current = true;
                toast({
                  title: "Terminal connection failed",
                  description: j.message,
                  variant: "destructive",
                });
              }
              return;
            }
          } catch {
            t.write(ev.data);
          }
          return;
        }
        t.write(new Uint8Array(ev.data as ArrayBuffer));
      };
      ws.onerror = () => {
        if (disposed) return;
        setTerminalConnecting(false);
        const message = "WebSocket connection failed.";
        setTerminalError(message);
        if (!terminalFailureNotifiedRef.current) {
          terminalFailureNotifiedRef.current = true;
          toast({
            title: "Terminal connection failed",
            description: message,
            variant: "destructive",
          });
        }
      };
      ws.onclose = (ev) => {
        if (disposed) return;
        setTerminalConnecting(false);
        if (ev.code !== 1000) {
          const message = ev.reason || `Connection closed (code ${ev.code}).`;
          setTerminalError((prev) => prev ?? message);
          if (!terminalFailureNotifiedRef.current) {
            terminalFailureNotifiedRef.current = true;
            toast({
              title: "Terminal session closed",
              description: message,
              variant: "destructive",
            });
          }
        }
      };

      t.onData((data) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(textEnc.encode(data));
      });
    })();

    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
      ws?.close();
      term?.dispose();
    };
  }, [terminalModalRow, localTerminalOpen, toast]);

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

  const editingRow =
    editingId != null ? (list.data ?? []).find((r) => r.id === editingId) ?? null : null;

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
              Connect and manage remote hosts via SSH keys. Assign each server a specific role,{" "}
              <strong>Deploy</strong> for running containers and stacks, or <strong>Build</strong> to handle heavy Docker
              builds externally.
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

        <div className="space-y-2">
          {!hideLocalDockerHost ? (
            <div className="glass-panel rounded-xl border border-border overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm truncate">Local Server</p>
                    <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border border-primary/35 text-primary bg-primary/10">
                      Local
                    </span>
                    <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border border-sky-500/35 text-sky-300/95 bg-sky-500/10">
                      Build
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    This local host is build-only. Use a remote Deploy host to run containers/services.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    href="/console/local/images"
                    scroll={false}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-white/5"
                    title="Open Docker console for this host"
                  >
                    <Container className="size-3.5" />
                    Docker Manager
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setTerminalModalRow(null);
                      setLocalTerminalOpen(true);
                    }}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-white/5"
                    title="Open local terminal"
                  >
                    <Terminal className="size-3.5" />
                    Terminal
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {(list.data ?? []).length === 0 && !creating ? (
            <p className="text-sm text-muted-foreground py-8 text-center border border-dashed border-border rounded-xl">
              No remote hosts yet. Add a host and paste a private key, or generate a new pair.
            </p>
          ) : null}

          {(list.data ?? []).map((row) => (
              <div
                key={row.id}
                className="glass-panel rounded-xl border border-border overflow-hidden"
              >
                <>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 py-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm truncate">{row.name}</p>
                        <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border border-primary/35 text-primary bg-primary/10">
                          Remote
                        </span>
                        <span
                          className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border ${
                            row.serverRole === "build"
                              ? "border-sky-500/35 text-sky-300/95 bg-sky-500/10"
                              : "border-blue-500/30 text-blue-300/90 bg-blue-500/10"
                          }`}
                        >
                          {row.serverRole === "build" ? "Build" : "Deploy"}
                        </span>
                        {row.authMode !== "stored" ? (
                          <span
                            className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border ${
                              row.authMode === "file"
                                ? "border-zinc-500/30 text-zinc-400 bg-zinc-500/10"
                                : "border-amber-500/30 text-amber-400/90 bg-amber-500/10"
                            }`}
                          >
                            {row.authMode === "file" ? "Legacy file" : "No key"}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground font-mono mt-1 truncate">
                        {row.sshUser}@{row.host}
                        {row.port !== 22 ? `:${row.port}` : ""}
                      </p>
                      {row.publicIpv4 ? (
                        <p className="text-[11px] text-muted-foreground font-mono mt-1">
                          Public IPv4: {row.publicIpv4}
                        </p>
                      ) : null}
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
                          href={`/console/${row.id}/images`}
                          scroll={false}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-white/5"
                          title="Open Docker console for this host (full Docker UI)"
                        >
                          <Container className="size-3.5" />
                          Docker Manager
                        </Link>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-border opacity-40 cursor-not-allowed"
                          title="Configure a private key first"
                        >
                          <Container className="size-3.5" />
                          Docker Manager
                        </span>
                      )}
                      <button
                        type="button"
                        disabled={!row.hasPrivateKey}
                        onClick={() => setTestModalRow(row)}
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-white/5 disabled:opacity-40"
                        title="Open test options"
                      >
                        <FlaskConical className="size-3.5" />
                        Test
                      </button>
                      <button
                        type="button"
                        disabled={!row.hasPrivateKey}
                        onClick={() => {
                          setTerminalModalRow(row);
                          setLocalTerminalOpen(false);
                        }}
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-white/5 disabled:opacity-40"
                        title="Open remote SSH terminal"
                      >
                        <Terminal className="size-3.5" />
                        Terminal
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setGeneratedPublicKey(null);
                          setEditingId(row.id);
                        }}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-white/5"
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
                  <RemoteServerInstallBlock accessToken={accessToken} row={row} />
                </>
              </div>
            ))}
        </div>

      </div>
      {typeof document !== "undefined" && creating
        ? createPortal(
            <div
              className="fixed inset-0 z-[120] overflow-y-auto flex min-h-full items-center justify-center p-4 bg-black/40 backdrop-blur-xl dark:bg-black/55"
              onClick={() => {
                if (createMut.isPending) return;
                dismissCreateHostModal();
              }}
            >
              <div
                className="w-full max-w-2xl rounded-2xl glass-panel p-5 space-y-3 max-h-[90vh] overflow-y-auto shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold">Add host</h3>
                    <p className="text-xs text-muted-foreground mt-1">New remote Docker host</p>
                  </div>
                  <button
                    type="button"
                    disabled={createMut.isPending}
                    onClick={dismissCreateHostModal}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-40"
                    aria-label="Close add host dialog"
                  >
                    <X className="size-4" />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={generateMut.isPending || createMut.isPending}
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
                <div className="space-y-2">
                  <span className="text-xs text-muted-foreground">Server role</span>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        {
                          value: "deploy" as const,
                          title: "Deploy",
                          hint: "Run docker stack / compose on this host",
                        },
                        {
                          value: "build" as const,
                          title: "Build",
                          hint: "Image builds only; pick a deploy host for running containers",
                        },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, serverRole: opt.value }))}
                        className={`flex-1 min-w-[140px] text-left rounded-lg border px-3 py-2 transition-colors ${
                          form.serverRole === opt.value
                            ? "border-primary/40 bg-primary/10 text-foreground"
                            : "border-border bg-muted/60 dark:bg-black/20 text-muted-foreground hover:border-border"
                        }`}
                      >
                        <span className="text-xs font-medium block">{opt.title}</span>
                        <span className="text-[10px] text-muted-foreground leading-snug block mt-0.5">
                          {opt.hint}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 block">
                    <span className="text-xs text-muted-foreground">Label</span>
                    <input
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      className="w-full rounded-lg border border-border bg-muted dark:bg-black/40 px-3 py-2 text-sm"
                      placeholder="Production"
                    />
                  </label>
                  <label className="space-y-1 block">
                    <span className="text-xs text-muted-foreground">Host / IP</span>
                    <input
                      value={form.host}
                      onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                      className="w-full rounded-lg border border-border bg-muted dark:bg-black/40 px-3 py-2 text-sm"
                      placeholder="203.0.113.10"
                    />
                  </label>
                  <label className="space-y-1 block">
                    <span className="text-xs text-muted-foreground">SSH port</span>
                    <input
                      value={form.port}
                      onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
                      className="w-full rounded-lg border border-border bg-muted dark:bg-black/40 px-3 py-2 text-sm"
                      placeholder="22"
                    />
                  </label>
                  <label className="space-y-1 block">
                    <span className="text-xs text-muted-foreground">SSH user</span>
                    <input
                      value={form.sshUser}
                      onChange={(e) => setForm((f) => ({ ...f, sshUser: e.target.value }))}
                      className="w-full rounded-lg border border-border bg-muted dark:bg-black/40 px-3 py-2 text-sm"
                      placeholder="deploy"
                    />
                  </label>
                  <label className="space-y-1 block sm:col-span-2">
                    <span className="text-xs text-muted-foreground">Public IPv4 (optional, traefik.me)</span>
                    <input
                      value={form.publicIpv4}
                      onChange={(e) => setForm((f) => ({ ...f, publicIpv4: e.target.value }))}
                      className="w-full rounded-lg border border-border bg-muted dark:bg-black/40 px-3 py-2 text-sm font-mono"
                      placeholder="203.0.113.10"
                      autoComplete="off"
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
                      className="w-full min-h-[140px] rounded-lg border border-border bg-muted dark:bg-black/40 px-3 py-2 text-xs font-mono"
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
                    disabled={createMut.isPending}
                    onClick={dismissCreateHostModal}
                    className="text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground disabled:opacity-40"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {typeof document !== "undefined" && editingRow
        ? createPortal(
            <div
              className="fixed inset-0 z-[120] overflow-y-auto flex min-h-full items-center justify-center p-4 bg-black/40 backdrop-blur-xl dark:bg-black/55"
              onClick={() => {
                if (updateMut.isPending) return;
                dismissEditHostModal();
              }}
            >
              <div
                className="w-full max-w-2xl rounded-2xl glass-panel p-5 space-y-3 max-h-[90vh] overflow-y-auto shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold">Edit host</h3>
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      {editingRow.name} · {editingRow.sshUser}@{editingRow.host}
                      {editingRow.port !== 22 ? `:${editingRow.port}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={updateMut.isPending}
                    onClick={dismissEditHostModal}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-40"
                    aria-label="Close edit host dialog"
                  >
                    <X className="size-4" />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border border-primary/35 text-primary bg-primary/10">
                    Remote
                  </span>
                  <button
                    type="button"
                    disabled={generateMut.isPending || updateMut.isPending}
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
                {generatedPublicKey ? <PublicKeyCopyBlock publicKey={generatedPublicKey} /> : null}
                <div className="space-y-2">
                  <span className="text-xs text-muted-foreground">Server role</span>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        {
                          value: "deploy" as const,
                          title: "Deploy",
                          hint: "Runs containers / stack deploy",
                        },
                        {
                          value: "build" as const,
                          title: "Build",
                          hint: "Dedicated docker build host",
                        },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setEditDraft((d) => ({ ...d, serverRole: opt.value }))}
                        className={`flex-1 min-w-[140px] text-left rounded-lg border px-3 py-2 transition-colors ${
                          editDraft.serverRole === opt.value
                            ? "border-primary/40 bg-primary/10 text-foreground"
                            : "border-border bg-muted/60 dark:bg-black/20 text-muted-foreground hover:border-border"
                        }`}
                      >
                        <span className="text-xs font-medium block">{opt.title}</span>
                        <span className="text-[10px] text-muted-foreground leading-snug block mt-0.5">
                          {opt.hint}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 block">
                    <span className="text-xs text-muted-foreground">Label</span>
                    <input
                      value={editDraft.name}
                      onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                      className="w-full rounded-lg border border-border bg-muted dark:bg-black/40 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="space-y-1 block">
                    <span className="text-xs text-muted-foreground">Host</span>
                    <input
                      value={editDraft.host}
                      onChange={(e) => setEditDraft((d) => ({ ...d, host: e.target.value }))}
                      className="w-full rounded-lg border border-border bg-muted dark:bg-black/40 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="space-y-1 block">
                    <span className="text-xs text-muted-foreground">SSH port</span>
                    <input
                      value={editDraft.port}
                      onChange={(e) => setEditDraft((d) => ({ ...d, port: e.target.value }))}
                      className="w-full rounded-lg border border-border bg-muted dark:bg-black/40 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="space-y-1 block">
                    <span className="text-xs text-muted-foreground">SSH user</span>
                    <input
                      value={editDraft.sshUser}
                      onChange={(e) => setEditDraft((d) => ({ ...d, sshUser: e.target.value }))}
                      className="w-full rounded-lg border border-border bg-muted dark:bg-black/40 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="space-y-1 block sm:col-span-2">
                    <span className="text-xs text-muted-foreground">Public IPv4 (optional, traefik.me)</span>
                    <input
                      value={editDraft.publicIpv4}
                      onChange={(e) => setEditDraft((d) => ({ ...d, publicIpv4: e.target.value }))}
                      className="w-full rounded-lg border border-border bg-muted dark:bg-black/40 px-3 py-2 text-sm font-mono"
                      placeholder="203.0.113.10"
                      autoComplete="off"
                    />
                  </label>
                  {editingRow.authMode === "file" ? (
                    <p className="text-xs text-muted-foreground sm:col-span-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                      Legacy: key file on API host at{" "}
                      <code className="text-[11px] break-all">{editingRow.privateKeyPath}</code>. Paste a new private key
                      below to migrate to encrypted storage.
                    </p>
                  ) : null}
                  <label className="space-y-1 block sm:col-span-2">
                    <span className="text-xs text-muted-foreground">Replace private key (optional PEM)</span>
                    <textarea
                      value={editDraft.privateKeyReplace}
                      onChange={(e) => {
                        setEditDraft((d) => ({ ...d, privateKeyReplace: e.target.value }));
                        if (!e.target.value.trim()) {
                          setGeneratedPublicKey(null);
                        }
                      }}
                      className="w-full min-h-[100px] rounded-lg border border-border bg-muted dark:bg-black/40 px-3 py-2 font-mono text-xs"
                      placeholder="Leave empty to keep current key, or paste / generate a new one"
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </label>
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    disabled={updateMut.isPending}
                    onClick={() => updateMut.mutate(editingRow)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/25 text-emerald-400"
                  >
                    {updateMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
                  </button>
                  <button
                    type="button"
                    disabled={updateMut.isPending}
                    onClick={dismissEditHostModal}
                    className="text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground disabled:opacity-40"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {typeof document !== "undefined" && testModalRow
        ? createPortal(
            <div
              className="fixed inset-0 z-[120] overflow-y-auto modal-scrim flex min-h-full items-center justify-center p-4"
              onClick={() => setTestModalRow(null)}
            >
              <div
                className="w-full max-w-md rounded-2xl glass-panel p-5 space-y-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold">Test connection</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      {testModalRow.name} ({testModalRow.sshUser}@{testModalRow.host})
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTestModalRow(null)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                    aria-label="Close test dialog"
                  >
                    <X className="size-4" />
                  </button>
                </div>

                <div className="space-y-2">
                  <button
                    type="button"
                    disabled={testSshMut.isPending || testMut.isPending}
                    onClick={() => testSshMut.mutate(testModalRow.id)}
                    className="w-full inline-flex items-center justify-center gap-2 text-sm px-3 py-2 rounded-lg border border-border hover:bg-white/5 disabled:opacity-40"
                    title="SSH only: ssh2 + shell (echo + uname). Does not use Docker."
                  >
                    {testSshMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                    SSH
                  </button>
                  <button
                    type="button"
                    disabled={testMut.isPending || testSshMut.isPending}
                    onClick={() => testMut.mutate(testModalRow.id)}
                    className="w-full inline-flex items-center justify-center gap-2 text-sm px-3 py-2 rounded-lg border border-border hover:bg-white/5 disabled:opacity-40"
                    title="Remote Docker API via Dockerode over SSH (same path as the Docker Manager)"
                  >
                    {testMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
                    Docker
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {typeof document !== "undefined" && (terminalModalRow || localTerminalOpen)
        ? createPortal(
            <div
              className="fixed inset-0 z-[120] overflow-y-auto modal-scrim flex min-h-full items-center justify-center p-4"
              onClick={() => {
                setTerminalModalRow(null);
                setLocalTerminalOpen(false);
              }}
            >
              <div
                className="w-full max-w-4xl rounded-2xl glass-panel p-5 space-y-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold">Remote Terminal</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      {terminalModalRow
                        ? `${terminalModalRow.sshUser}@${terminalModalRow.host}${terminalModalRow.port !== 22 ? `:${terminalModalRow.port}` : ""}`
                        : "Local Server"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setTerminalModalRow(null);
                      setLocalTerminalOpen(false);
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                    aria-label="Close terminal dialog"
                  >
                    <X className="size-4" />
                  </button>
                </div>

                <div className="space-y-2">
                  {terminalError && (
                    <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {terminalError}
                    </div>
                  )}
                  {terminalConnecting && !terminalError && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      Connecting terminal…
                    </div>
                  )}
                  <div
                    ref={terminalContainerRef}
                    className="h-[62vh] min-h-[360px] w-full rounded-lg overflow-hidden border border-border/50 bg-zinc-950"
                  />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
