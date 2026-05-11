"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Container,
  Globe,
  KeyRound,
  Loader2,
  Plus,
  Terminal,
  Trash2,
  PlugZap,
  FlaskConical,
  X,
} from "lucide-react";
import { MaskedPemTextarea } from "@/components/remote-server/masked-pem-textarea";
import { PublicKeyCopyBlock } from "@/components/remote-server/public-key-copy-block";
import { RemoteServerInstallBlock } from "@/components/remote-server/remote-server-install-block";
import { useAuth } from "@/contexts/auth-context";
import { appendTerminalWsTicketQuery, fetchWebsocketTerminalTicket } from "@/lib/auth-api";
import {
  createRemoteServerApi,
  deleteRemoteServerApi,
  fetchRemoteServers,
  restoreSelfHostedLocalHostApi,
  generateRemoteSshKeypairApi,
  remoteTerminalWsUrlCandidates,
  testRemoteServerApi,
  testRemoteServerSshApi,
  updateRemoteServerApi,
  type RemoteServerRow,
  type RemoteServerRole,
} from "@/lib/remote-servers-api";
import {
  isSelfHostedBootstrapRemoteServer,
  SELF_HOSTED_BOOTSTRAP_SSH_HOST,
} from "@/lib/loopback-ssh-host";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { useToast } from "@/hooks/use-toast";
import { useOptionalOrgWorkspace } from "@/(platform)/org-workspace/org-workspace-context";
import { orgScopedQuerySegment } from "@/lib/react-query-scope";
import {
  orgMemberAllowsDomainsAddSites,
  orgMemberAllowsRemoteServerAdd,
  orgMemberAllowsRemoteServerDelete,
  orgMemberAllowsRemoteServerDockerManager,
  orgMemberAllowsRemoteServerEdit,
  orgMemberAllowsRemoteServerInstallMaintenance,
  orgMemberAllowsRemoteServerTerminal,
  orgMemberAllowsRemoteServerTest,
} from "@/lib/org-workspace-permissions";
import { cn } from "@/lib/utils";
/** When Host is a dotted public IPv4, it is stored as `publicIpv4` (e.g. Magic traefik.me). Hostnames are SSH-only. */
function parseDottedPublicIpv4(hostOrIp: string): string | null {
  const t = hostOrIp.trim();
  if (
    /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/.test(t)
  ) {
    return t;
  }
  return null;
}

function emptyForm() {
  return {
    name: "",
    host: "",
    port: "22",
    sshUser: "",
    privateKey: "",
    serverRole: "deploy" as RemoteServerRole,
    acmeEmail: "",
  };
}

type EditDraft = {
  name: string;
  host: string;
  port: string;
  sshUser: string;
  privateKeyReplace: string;
  serverRole: RemoteServerRole;
  acmeEmail: string;
};

function emptyEditDraft(): EditDraft {
  return {
    name: "",
    host: "",
    port: "22",
    sshUser: "",
    privateKeyReplace: "",
    serverRole: "deploy",
    acmeEmail: "",
  };
}

function remoteServerRouteId(row: Pick<RemoteServerRow, "id" | "publicId">): string {
  const pub = row.publicId?.trim();
  return pub && pub.length > 0 ? pub : String(row.id);
}

export type RemoteServerSettingsPageVariant = "list" | "add-this-machine" | "add-host";

export function RemoteServerSettingsClient({
  initialRemoteServers,
  activeOrgPublicId = null,
  initialRemoteServersOrganizationId = null,
  pageVariant = "list",
}: {
  initialRemoteServers?: RemoteServerRow[];
  /** When set (org workspace), list/create servers scoped to this organization. */
  activeOrgPublicId?: string | null;
  initialRemoteServersOrganizationId?: string | null;
  pageVariant?: RemoteServerSettingsPageVariant;
}) {
  const router = useRouter();
  const { accessToken, user } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const orgWorkspace = useOptionalOrgWorkspace();
  const trimmedOrg = activeOrgPublicId?.trim() ?? "";
  const orgScopeSegment = orgScopedQuerySegment(trimmedOrg);
  const trimmedSsrServersOrg = initialRemoteServersOrganizationId?.trim() ?? "";
  const useSsrRemoteInitial =
    initialRemoteServers !== undefined && trimmedOrg === trimmedSsrServersOrg;
  const inOrgRemoteServerPage = Boolean(trimmedOrg);
  const allowOrgTerminal =
    !inOrgRemoteServerPage ||
    (orgWorkspace != null &&
      orgMemberAllowsRemoteServerTerminal(orgWorkspace.workspacePermissions));
  const allowOrgDocker =
    !inOrgRemoteServerPage ||
    (orgWorkspace != null &&
      orgMemberAllowsRemoteServerDockerManager(orgWorkspace.workspacePermissions));
  const allowOrgTest =
    !inOrgRemoteServerPage ||
    (orgWorkspace != null && orgMemberAllowsRemoteServerTest(orgWorkspace.workspacePermissions));
  const allowOrgAdd =
    !inOrgRemoteServerPage ||
    (orgWorkspace != null && orgMemberAllowsRemoteServerAdd(orgWorkspace.workspacePermissions));
  const allowOrgEdit =
    !inOrgRemoteServerPage ||
    (orgWorkspace != null && orgMemberAllowsRemoteServerEdit(orgWorkspace.workspacePermissions));
  const allowOrgDelete =
    !inOrgRemoteServerPage ||
    (orgWorkspace != null && orgMemberAllowsRemoteServerDelete(orgWorkspace.workspacePermissions));
  const allowOrgInstallMaintenance =
    !inOrgRemoteServerPage ||
    (orgWorkspace != null &&
      orgMemberAllowsRemoteServerInstallMaintenance(orgWorkspace.workspacePermissions));
  const allowOrgDomains =
    !inOrgRemoteServerPage ||
    (orgWorkspace != null &&
      orgMemberAllowsDomainsAddSites(orgWorkspace.workspacePermissions));
  const showConnectionTests =
    allowOrgTest && (allowOrgTerminal || allowOrgDocker);
  const instanceMode = (process.env.NEXT_PUBLIC_INSTANCE_MODE ?? "cloud")
    .trim()
    .toLowerCase();
  const isSelfHosted = instanceMode === "self-hosted";
  const showRestoreLocalHost =
    isSelfHosted &&
    user?.role === "ADMIN" &&
    inOrgRemoteServerPage &&
    allowOrgAdd;
  const remoteServersQueryKey = ["remote-servers", orgScopeSegment] as const;
  const listNeeded =
    pageVariant === "list" ||
    pageVariant === "add-this-machine" ||
    pageVariant === "add-host";
  const list = useQuery({
    queryKey: remoteServersQueryKey,
    queryFn: () => fetchRemoteServers(accessToken ?? ""),
    enabled: Boolean(accessToken) && listNeeded,
    initialData: useSsrRemoteInitial && listNeeded ? initialRemoteServers : undefined,
    initialDataUpdatedAt: useSsrRemoteInitial && listNeeded ? Date.now() : undefined,
    staleTime: 10_000,
    refetchOnMount: true,
  });

  const [showPrivateKeyCreate, setShowPrivateKeyCreate] = useState(false);
  const [showPrivateKeyEdit, setShowPrivateKeyEdit] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [generatedPublicKey, setGeneratedPublicKey] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>(emptyEditDraft);
  const [testModalRow, setTestModalRow] = useState<RemoteServerRow | null>(null);
  const [terminalModalRow, setTerminalModalRow] = useState<RemoteServerRow | null>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalFailureNotifiedRef = useRef(false);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [terminalConnecting, setTerminalConnecting] = useState(false);
  const [localHostAcmeEmail, setLocalHostAcmeEmail] = useState("");

  useEffect(() => {
    if (!accessToken) return;
    // Force fresh install-script previews on every Remote servers page entry.
    void qc.refetchQueries({ queryKey: ["provision-script"], type: "active" });
    void qc.invalidateQueries({ queryKey: ["provision-script"] });
  }, [accessToken, qc]);

  useEffect(() => {
    if (pageVariant !== "add-host") return;
    setForm(emptyForm());
    setGeneratedPublicKey(null);
    setShowPrivateKeyCreate(false);
  }, [pageVariant]);

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
          serverRole: row.serverRole,
          acmeEmail: row.acmeEmail ?? "",
        });
      }
    }
  }, [editingId, list.data]);

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
        setShowPrivateKeyEdit(false);
        setEditDraft((d) => ({ ...d, privateKeyReplace: data.privateKey }));
        toast({
          title: "Key pair generated",
          description: "Public key copied below; save to store the new private key encrypted.",
        });
      } else {
        setShowPrivateKeyCreate(false);
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

  const restoreLocalHostMut = useMutation({
    mutationFn: () =>
      restoreSelfHostedLocalHostApi(accessToken ?? "", trimmedOrg || null, localHostAcmeEmail),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: remoteServersQueryKey });
      const sshTarget = `${result.remoteServer.sshUser}@${result.remoteServer.host}`;
      if (result.alreadyPresent) {
        toast({
          title: "This Server already listed",
          description: `This Server (${sshTarget}) is already in Remote servers.`,
        });
      } else {
        toast({
          title: "Local host restored",
          description: `This Server (${sshTarget}) was added back to Remote servers.`,
        });
      }
      if (pageVariant === "add-this-machine") {
        router.push("/remote-server");
      }
    },
    onError: (err) => {
      toast({
        title: "Could not restore local host",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const createMut = useMutation({
    mutationFn: () => {
      const pip = parseDottedPublicIpv4(form.host);
      return createRemoteServerApi(accessToken ?? "", {
        name: form.name.trim(),
        host: form.host.trim(),
        port: form.port.trim() ? Number(form.port) : 22,
        sshUser: form.sshUser.trim(),
        privateKey: form.privateKey.trim(),
        serverRole: form.serverRole,
        acmeEmail: form.acmeEmail.trim(),
        ...(pip ? { publicIpv4: pip } : {}),
        ...(activeOrgPublicId?.trim()
          ? { organizationPublicId: activeOrgPublicId.trim() }
          : {}),
      });
    },
    onSuccess: (created) => {
      qc.setQueryData<RemoteServerRow[]>(remoteServersQueryKey, (prev) => {
        const rows = prev ?? [];
        if (rows.some((r) => r.id === created.id)) return rows;
        return [created, ...rows];
      });
      qc.invalidateQueries({ queryKey: remoteServersQueryKey });
      setForm(emptyForm());
      setGeneratedPublicKey(null);
      setShowPrivateKeyCreate(false);
      toast({ title: "Remote host saved" });
      if (pageVariant === "add-host") {
        router.push("/remote-server");
      }
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
        publicIpv4: parseDottedPublicIpv4(editDraft.host),
        acmeEmail: editDraft.acmeEmail.trim(),
      };
      const pem = editDraft.privateKeyReplace.trim();
      if (pem) {
        patch.privateKey = pem;
      }
      return updateRemoteServerApi(accessToken ?? "", remoteServerRouteId(row), patch);
    },
    onSuccess: (updated) => {
      qc.setQueryData<RemoteServerRow[]>(remoteServersQueryKey, (prev) => {
        const rows = prev ?? [];
        return rows.map((r) => (r.id === updated.id ? updated : r));
      });
      void qc.invalidateQueries({ queryKey: remoteServersQueryKey });
      setEditingId(null);
      toast({ title: "Updated" });
    },
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteRemoteServerApi(accessToken ?? "", id),
    onSuccess: (_data, id) => {
      qc.setQueryData<RemoteServerRow[]>(remoteServersQueryKey, (prev) =>
        (prev ?? []).filter((r) => remoteServerRouteId(r) !== id),
      );
      void qc.invalidateQueries({ queryKey: remoteServersQueryKey });
      toast({ title: "Removed" });
    },
    onError: (e: Error) =>
      toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  function dismissEditHostModal() {
    setEditingId(null);
    setGeneratedPublicKey(null);
    setShowPrivateKeyEdit(false);
  }

  function dismissAddSubModal() {
    setForm(emptyForm());
    setGeneratedPublicKey(null);
    setShowPrivateKeyCreate(false);
    router.push("/remote-server");
  }

  const testMut = useMutation({
    mutationFn: (id: string) => testRemoteServerApi(accessToken ?? "", id),
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
    mutationFn: (id: string) => testRemoteServerSshApi(accessToken ?? "", id),
    onSuccess: (data) => {
      toast({
        title: data.success ? "Connected via SSH" : "SSH connection failed",
        description: data.output.slice(0, 900) + (data.output.length > 900 ? "…" : ""),
        variant: data.success ? "default" : "destructive",
      });
    },
    onError: (e: Error) =>
      toast({ title: "SSH test failed", description: e.message, variant: "destructive" }),
  });
  useEffect(() => {
    const row = terminalModalRow;
    const open = row != null;
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

      const isDark = document.documentElement.classList.contains("dark");
      const t = new XTerm({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        theme: isDark
          ? { background: "#09090b", foreground: "#e4e4e7" }
          : { background: "#f8fafc", foreground: "#0f172a" },
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

      let ticket: string | null;
      try {
        ticket = await fetchWebsocketTerminalTicket(accessToken);
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Could not authorize the terminal. Sign in again.";
        setTerminalError(message);
        setTerminalConnecting(false);
        if (!terminalFailureNotifiedRef.current) {
          terminalFailureNotifiedRef.current = true;
          toast({
            title: "Terminal connection failed",
            description: message,
            variant: "destructive",
          });
        }
        return;
      }
      if (disposed) return;

      const baseUrls = remoteTerminalWsUrlCandidates(remoteServerRouteId(row));
      const urls =
        ticket != null
          ? baseUrls.map((u) => appendTerminalWsTicketQuery(u, ticket))
          : baseUrls;
      let activeUrlIndex = 0;
      const connect = (index: number) => {
        if (disposed) return;
        activeUrlIndex = index;
        const socket = new WebSocket(urls[index]);
        ws = socket;
        socket.binaryType = "arraybuffer";
        let opened = false;

        socket.onopen = () => {
          if (disposed || ws !== socket) return;
          opened = true;
          setTerminalConnecting(false);
          fa.fit();
          pushResize();
          t.focus();
        };
        socket.onmessage = (ev: MessageEvent<string | ArrayBuffer>) => {
          if (disposed || ws !== socket) return;
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
        socket.onerror = () => {
          if (disposed || ws !== socket) return;
          // Wait for close to determine fallback vs final failure.
        };
        socket.onclose = (ev) => {
          if (disposed || ws !== socket) return;
          if (!opened && activeUrlIndex < urls.length - 1) {
            connect(activeUrlIndex + 1);
            return;
          }
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
      };
      connect(0);

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
  }, [terminalModalRow, toast, accessToken]);

  const addHostFormBody = (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          type="button"
          disabled={generateMut.isPending || createMut.isPending}
          onClick={() => generateMut.mutate("create")}
          className="btn-secondary inline-flex w-full items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium disabled:opacity-50 sm:w-auto sm:py-1.5"
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
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
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
              className={`w-full text-left rounded-lg border px-3 py-2 transition-colors sm:min-w-[140px] sm:flex-1 ${
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
            autoComplete="off"
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
          <span className="text-xs text-muted-foreground">
            Certificate email (For Let&apos;s Encrypt notices)
          </span>
          <input
            type="email"
            value={form.acmeEmail}
            onChange={(e) => setForm((f) => ({ ...f, acmeEmail: e.target.value }))}
            className="w-full rounded-lg border border-border bg-muted dark:bg-black/40 px-3 py-2 text-sm"
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </label>
        <div className="space-y-1 sm:col-span-2">
          <span className="block text-xs text-muted-foreground">Private key (PEM)</span>
          <MaskedPemTextarea
            revealed={showPrivateKeyCreate}
            onRevealedChange={setShowPrivateKeyCreate}
            value={form.privateKey}
            onChange={(e) => {
              setForm((f) => ({ ...f, privateKey: e.target.value }));
              setGeneratedPublicKey(null);
            }}
            className="w-full min-h-[140px] rounded-lg border border-border bg-muted px-3 py-2 text-xs font-mono dark:bg-black/40"
            placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n..."}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      </div>
    </>
  );

  if (!accessToken) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  if (listNeeded && list.isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="size-6 animate-spin" />
        Loading…
      </div>
    );
  }

  if (listNeeded && list.isError) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-red-200 text-sm">
        {(list.error as Error).message}
      </div>
    );
  }

  const editingRow =
    editingId != null ? (list.data ?? []).find((r) => r.id === editingId) ?? null : null;
  const editingBootstrapHost =
    editingRow != null && isSelfHostedBootstrapRemoteServer(editingRow);

  return (
    <div className="w-full space-y-6 pb-[max(1rem,env(safe-area-inset-bottom))] sm:space-y-8 sm:pb-0">
      <header className="space-y-2">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Remote servers</h1>
        <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
          Connect and manage remote hosts via SSH keys. Assign each server a specific role,{" "}
          <strong className="font-semibold text-violet-900 dark:text-violet-100">Deploy</strong> for running containers and
          stacks, or{" "}
          <strong className="font-semibold text-violet-900 dark:text-violet-100">Build</strong> to handle heavy Docker builds
          externally.
        </p>
      </header>

      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Hosts</h2>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
            {showRestoreLocalHost ? (
              <Link
                href="/remote-server/add-this-machine"
                title={`Re-add the default This Server (root@${SELF_HOSTED_BOOTSTRAP_SSH_HOST}) deploy host for this instance`}
                className="btn-secondary inline-flex min-h-11 w-full items-center justify-center gap-1.5 text-sm sm:min-h-0 sm:w-auto"
              >
                <PlugZap className="size-3.5" />
                Add This Server
              </Link>
            ) : null}
            {inOrgRemoteServerPage && !allowOrgAdd ? (
              <span
                title="Your role cannot add remote hosts in this organization"
                className="btn-primary inline-flex min-h-11 w-full cursor-not-allowed items-center justify-center gap-1.5 text-sm opacity-40 sm:min-h-0 sm:w-auto"
              >
                <Plus className="size-3.5" />
                Add host
              </span>
            ) : (
              <Link
                href="/remote-server/add-host"
                title="Add a remote host"
                className="btn-primary inline-flex min-h-11 w-full items-center justify-center gap-1.5 text-sm sm:min-h-0 sm:w-auto"
              >
                <Plus className="size-3.5" />
                Add host
              </Link>
            )}
          </div>
        </div>

        <div className="space-y-2">
          {(list.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground px-3 py-8 text-center border border-dashed border-border rounded-xl sm:px-4">
              No remote hosts yet.{" "}
              {inOrgRemoteServerPage && !allowOrgAdd ? (
                <>Ask an admin to add a host, or switch workspace.</>
              ) : (
                <>
                  <Link href="/remote-server/add-host" className="font-medium text-primary hover:underline">
                    Add a host
                  </Link>{" "}
                  and paste a private key, or generate a new pair.
                </>
              )}
            </p>
          ) : null}

          {(list.data ?? []).map((row) => {
            const isBootstrapHost = isSelfHostedBootstrapRemoteServer(row);
            return (
              <div
                key={row.id}
                className="glass-panel rounded-xl border border-border overflow-hidden"
              >
                <>
                  <div
                    className={cn(
                      "flex flex-col gap-4 px-4 py-4 sm:flex-row sm:justify-between sm:gap-3 sm:px-5 sm:py-4",
                      isBootstrapHost ? "sm:items-center" : "sm:items-start",
                    )}
                  >
                    {/* `flex-1` only from `sm:` so the column on phones does not grow and pin actions to the bottom */}
                    <div className="min-w-0 sm:min-h-0 sm:flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="min-w-0 max-w-full break-words font-medium text-sm sm:truncate">{row.name}</p>
                        {isBootstrapHost ? (
                          <>
                            <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border border-emerald-500/45 bg-emerald-500/12 text-emerald-900 dark:text-emerald-100">
                              Localhost
                            </span>
                            <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border border-violet-500/50 bg-violet-500/15 text-violet-900 dark:text-violet-100">
                              {row.serverRole === "build" ? "Build" : "Deploy"}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border border-primary/35 text-primary bg-primary/10">
                              Remote
                            </span>
                            <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border border-violet-500/50 bg-violet-500/15 text-violet-900 dark:text-violet-100">
                              {row.serverRole === "build" ? "Build" : "Deploy"}
                            </span>
                          </>
                        )}
                        {row.authMode !== "stored" ? (
                          <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border border-amber-500/30 text-amber-400/90 bg-amber-500/10">
                            No key
                          </span>
                        ) : null}
                      </div>
                      {isBootstrapHost ? (
                        <p className="mt-1 text-xs leading-snug text-muted-foreground sm:max-w-md">
                          The machine where Weehawk is running.
                        </p>
                      ) : (
                        <p className="mt-1 break-all font-mono text-xs text-muted-foreground sm:truncate">
                          {row.sshUser}@{row.host}
                          {row.port !== 22 ? `:${row.port}` : ""}
                        </p>
                      )}
                    </div>
                    <div className="grid w-full min-w-0 grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end">
                      {row.hasPrivateKey && allowOrgDocker ? (
                        <Link
                          href={`/docker-manager/${remoteServerRouteId(row)}/images`}
                          scroll={false}
                          className="btn-secondary col-span-2 inline-flex min-h-10 items-center justify-center gap-1 px-2.5 py-2 text-xs sm:col-span-1 sm:min-h-0 sm:w-auto sm:py-1.5"
                          title="Open Docker console for this host (full Docker UI)"
                        >
                          <Container className="size-3.5 shrink-0" />
                          <span className="truncate">Docker Manager</span>
                        </Link>
                      ) : (
                        <span
                          className="btn-secondary col-span-2 inline-flex min-h-10 cursor-not-allowed items-center justify-center gap-1 px-2.5 py-2 text-xs opacity-40 sm:col-span-1 sm:min-h-0 sm:w-auto sm:py-1.5"
                          title={
                            !row.hasPrivateKey
                              ? "Configure a private key first"
                              : inOrgRemoteServerPage
                                ? "Docker Manager is disabled for your role in this organization"
                                : "Docker Manager unavailable"
                          }
                        >
                          <Container className="size-3.5 shrink-0" />
                          <span className="truncate">Docker Manager</span>
                        </span>
                      )}
                      <button
                        type="button"
                        disabled={!row.hasPrivateKey || !showConnectionTests}
                        onClick={() => setTestModalRow(row)}
                        className="btn-secondary inline-flex min-h-10 items-center justify-center gap-1 px-2.5 py-2 text-xs disabled:opacity-40 sm:min-h-0 sm:py-1.5"
                        title={
                          !showConnectionTests && inOrgRemoteServerPage
                            ? !allowOrgTest
                              ? "Connection tests are disabled for your role"
                              : "Enable Terminal or Docker Manager under org permissions to run tests"
                            : "Open test options"
                        }
                      >
                        <FlaskConical className="size-3.5 shrink-0" />
                        Test
                      </button>
                      <button
                        type="button"
                        disabled={!row.hasPrivateKey || !allowOrgTerminal}
                        onClick={() => {
                          setTerminalModalRow(row);
                        }}
                        className="btn-secondary inline-flex min-h-10 items-center justify-center gap-1 px-2.5 py-2 text-xs disabled:opacity-40 sm:min-h-0 sm:py-1.5"
                        title={
                          !allowOrgTerminal && inOrgRemoteServerPage
                            ? "Remote terminal is disabled for your role"
                            : "Open remote SSH terminal"
                        }
                      >
                        <Terminal className="size-3.5 shrink-0" />
                        Terminal
                      </button>
                      {row.serverRole === "deploy" ? (
                        allowOrgDomains ? (
                          <Link
                            href={`/domains/${remoteServerRouteId(row)}`}
                            scroll={false}
                            className="btn-secondary inline-flex min-h-10 items-center justify-center gap-1 px-2.5 py-2 text-xs sm:min-h-0 sm:py-1.5"
                            title="Manage site domains for this server"
                          >
                            <Globe className="size-3.5 shrink-0" />
                            Domains
                          </Link>
                        ) : (
                          <span
                            className="btn-secondary inline-flex min-h-10 cursor-not-allowed items-center justify-center gap-1 px-2.5 py-2 text-xs opacity-40 sm:min-h-0 sm:py-1.5"
                            title="Domains management is disabled for your role in this organization"
                          >
                            <Globe className="size-3.5 shrink-0" />
                            Domains
                          </span>
                        )
                      ) : null}
                      <button
                        type="button"
                        disabled={inOrgRemoteServerPage && !allowOrgEdit}
                        title={
                          inOrgRemoteServerPage && !allowOrgEdit
                            ? "Your role cannot edit remote hosts in this organization"
                            : isBootstrapHost
                              ? "Rotate SSH key or view details (connection target is fixed)"
                              : undefined
                        }
                        onClick={() => {
                          setGeneratedPublicKey(null);
                          setShowPrivateKeyEdit(false);
                          setEditingId(row.id);
                        }}
                        className="btn-secondary min-h-10 px-2.5 py-2 text-xs disabled:pointer-events-none disabled:opacity-40 sm:min-h-0 sm:py-1.5"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={deleteMut.isPending || (inOrgRemoteServerPage && !allowOrgDelete)}
                        title={
                          inOrgRemoteServerPage && !allowOrgDelete
                            ? "Your role cannot delete remote hosts in this organization"
                            : "Delete host"
                        }
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
                          deleteMut.mutate(remoteServerRouteId(row));
                        }}
                        className="inline-flex min-h-10 items-center justify-center rounded-lg border border-destructive/45 bg-destructive/10 p-2 text-destructive transition-colors hover:bg-destructive/15 disabled:pointer-events-none disabled:opacity-40 sm:min-h-0 sm:p-1.5"
                        aria-label="Delete host"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </div>
                  </div>
                  <RemoteServerInstallBlock
                    accessToken={accessToken}
                    row={row}
                    installMaintenanceAllowed={allowOrgInstallMaintenance}
                    activeOrgPublicIdForProvision={trimmedOrg}
                  />
                </>
              </div>
            );
          })}
        </div>

      </div>
      {typeof document !== "undefined" && pageVariant === "add-this-machine"
        ? createPortal(
            <div
              className="fixed inset-0 z-[120] flex min-h-[100dvh] items-end justify-center overflow-y-auto bg-black/40 p-0 backdrop-blur-xl dark:bg-black/55 sm:items-center sm:p-4"
              onClick={() => {
                if (restoreLocalHostMut.isPending) return;
                dismissAddSubModal();
              }}
            >
              <div
                className="glass-panel max-h-[calc(100dvh-env(safe-area-inset-bottom))] w-full max-w-2xl space-y-3 overflow-y-auto rounded-t-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-h-[90vh] sm:rounded-2xl sm:p-5 sm:pb-5"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 pr-2">
                    <h3 className="text-base font-semibold">Add This Server</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Re-add the default deploy host (
                      <span className="font-mono">root@{SELF_HOSTED_BOOTSTRAP_SSH_HOST}</span>) if it was removed from the
                      list.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={restoreLocalHostMut.isPending}
                    onClick={dismissAddSubModal}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-40 sm:h-8 sm:w-8"
                    aria-label="Close dialog"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                {showRestoreLocalHost ? (
                  <>
                    <label className="space-y-1 block">
                      <span className="text-xs text-muted-foreground">
                        Certificate email (For Let&apos;s Encrypt notices)
                      </span>
                      <input
                        type="email"
                        value={localHostAcmeEmail}
                        onChange={(e) => setLocalHostAcmeEmail(e.target.value)}
                        className="w-full rounded-lg border border-border bg-muted dark:bg-black/40 px-3 py-2 text-sm"
                        placeholder="you@example.com"
                        autoComplete="email"
                        required
                      />
                    </label>
                    <button
                      type="button"
                      disabled={restoreLocalHostMut.isPending || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(localHostAcmeEmail.trim())}
                      onClick={() => restoreLocalHostMut.mutate()}
                      className="btn-secondary inline-flex min-h-11 w-full items-center justify-center gap-1.5 text-sm disabled:pointer-events-none disabled:opacity-40 sm:w-auto"
                    >
                      {restoreLocalHostMut.isPending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <PlugZap className="size-3.5" />
                      )}
                      Add This Server
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground rounded-lg border border-dashed border-border px-3 py-4">
                    This action is only available to organization admins on self-hosted Weehawk, while working in an
                    organization workspace.
                  </p>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
      {typeof document !== "undefined" && pageVariant === "add-host"
        ? createPortal(
            <div
              className="fixed inset-0 z-[120] flex min-h-[100dvh] items-end justify-center overflow-y-auto bg-black/40 p-0 backdrop-blur-xl dark:bg-black/55 sm:items-center sm:p-4"
              onClick={() => {
                if (createMut.isPending) return;
                dismissAddSubModal();
              }}
            >
              <div
                className="glass-panel max-h-[calc(100dvh-env(safe-area-inset-bottom))] w-full max-w-2xl space-y-3 overflow-y-auto rounded-t-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-h-[90vh] sm:rounded-2xl sm:p-5 sm:pb-5"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 pr-2">
                    <h3 className="text-base font-semibold">Add host</h3>
                    <p className="mt-1 text-xs text-muted-foreground">New remote Docker host</p>
                  </div>
                  <button
                    type="button"
                    disabled={createMut.isPending}
                    onClick={dismissAddSubModal}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-40 sm:h-8 sm:w-8"
                    aria-label="Close add host dialog"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                {inOrgRemoteServerPage && !allowOrgAdd ? (
                  <p className="text-sm text-muted-foreground rounded-lg border border-dashed border-border px-3 py-4">
                    Your role cannot add remote hosts in this organization.
                  </p>
                ) : (
                  <>
                    {addHostFormBody}
                    <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                      <button
                        type="button"
                        disabled={createMut.isPending}
                        onClick={dismissAddSubModal}
                        className="btn-secondary order-2 w-full text-sm disabled:opacity-40 sm:order-1 sm:w-auto"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={createMut.isPending}
                        onClick={() => createMut.mutate()}
                        className="btn-primary order-1 inline-flex w-full items-center justify-center gap-1.5 text-sm disabled:pointer-events-none disabled:opacity-40 sm:order-2 sm:w-auto"
                      >
                        {createMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
      {typeof document !== "undefined" && editingRow
        ? createPortal(
            <div
              className="fixed inset-0 z-[120] flex min-h-[100dvh] items-end justify-center overflow-y-auto bg-black/40 p-0 backdrop-blur-xl dark:bg-black/55 sm:items-center sm:p-4"
              onClick={() => {
                if (updateMut.isPending) return;
                dismissEditHostModal();
              }}
            >
              <div
                className="glass-panel max-h-[calc(100dvh-env(safe-area-inset-bottom))] w-full max-w-2xl space-y-3 overflow-y-auto rounded-t-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-h-[90vh] sm:rounded-2xl sm:p-5 sm:pb-5"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 pr-2">
                    <h3 className="text-base font-semibold">Edit host</h3>
                    <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground sm:text-xs sm:truncate">
                      {editingRow.name} · {editingRow.sshUser}@{editingRow.host}
                      {editingRow.port !== 22 ? `:${editingRow.port}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={updateMut.isPending}
                    onClick={dismissEditHostModal}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-40 sm:h-8 sm:w-8"
                    aria-label="Close edit host dialog"
                  >
                    <X className="size-4" />
                  </button>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <span
                    className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border w-fit ${
                      isSelfHostedBootstrapRemoteServer(editingRow)
                        ? "border-emerald-500/45 bg-emerald-500/12 text-emerald-900 dark:text-emerald-100"
                        : "border-primary/35 text-primary bg-primary/10"
                    }`}
                  >
                    {isSelfHostedBootstrapRemoteServer(editingRow) ? "Localhost" : "Remote"}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border w-fit border-violet-500/50 bg-violet-500/15 text-violet-900 dark:text-violet-100">
                    {editDraft.serverRole === "build" ? "Build" : "Deploy"}
                  </span>
                  <button
                    type="button"
                    disabled={generateMut.isPending || updateMut.isPending}
                    onClick={() => generateMut.mutate("edit")}
                    className="btn-secondary inline-flex w-full items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium disabled:opacity-50 sm:w-auto sm:py-1.5"
                  >
                    {generateMut.isPending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <KeyRound className="size-3.5" />
                    )}
                    Generate new key pair
                  </button>
                  <span className="text-[11px] text-muted-foreground leading-snug sm:min-w-0 sm:flex-1">
                    Fills “replace” below; save to store the new private key
                  </span>
                </div>
                {generatedPublicKey ? <PublicKeyCopyBlock publicKey={generatedPublicKey} /> : null}
                <div className="space-y-2">
                  <span className="text-xs text-muted-foreground">Server role</span>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
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
                        className={`w-full text-left rounded-lg border px-3 py-2 transition-colors sm:min-w-[140px] sm:flex-1 ${
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
                      disabled={editingBootstrapHost}
                      className="w-full rounded-lg border border-border bg-muted dark:bg-black/40 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </label>
                  <label className="space-y-1 block">
                    <span className="text-xs text-muted-foreground">Host / IP</span>
                    <input
                      value={editDraft.host}
                      onChange={(e) => setEditDraft((d) => ({ ...d, host: e.target.value }))}
                      disabled={editingBootstrapHost}
                      className="w-full rounded-lg border border-border bg-muted dark:bg-black/40 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                      placeholder="203.0.113.10"
                      autoComplete="off"
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
                      disabled={editingBootstrapHost}
                      className="w-full rounded-lg border border-border bg-muted dark:bg-black/40 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </label>
                  <label className="space-y-1 block sm:col-span-2">
                    <span className="text-xs text-muted-foreground">
                      Certificate email (For Let&apos;s Encrypt notices)
                    </span>
                    <input
                      type="email"
                      value={editDraft.acmeEmail}
                      onChange={(e) => setEditDraft((d) => ({ ...d, acmeEmail: e.target.value }))}
                      className="w-full rounded-lg border border-border bg-muted dark:bg-black/40 px-3 py-2 text-sm"
                      placeholder="you@example.com"
                      autoComplete="email"
                    />
                  </label>
                  <div className="space-y-1 sm:col-span-2">
                    <span className="block text-xs text-muted-foreground">
                      Replace private key (optional PEM)
                    </span>
                    <MaskedPemTextarea
                      revealed={showPrivateKeyEdit}
                      onRevealedChange={setShowPrivateKeyEdit}
                      value={editDraft.privateKeyReplace}
                      onChange={(e) => {
                        setEditDraft((d) => ({ ...d, privateKeyReplace: e.target.value }));
                        if (!e.target.value.trim()) {
                          setGeneratedPublicKey(null);
                        }
                      }}
                      className="w-full min-h-[140px] rounded-lg border border-border bg-muted px-3 py-2 text-xs font-mono dark:bg-black/40"
                      placeholder="Leave empty to keep current key, or paste / generate a new one"
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                  <button
                    type="button"
                    disabled={updateMut.isPending}
                    onClick={dismissEditHostModal}
                    className="btn-secondary order-2 w-full text-sm disabled:opacity-40 sm:order-1 sm:w-auto"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={updateMut.isPending}
                    onClick={() => updateMut.mutate(editingRow)}
                    className="btn-primary order-1 inline-flex w-full items-center justify-center gap-1.5 text-sm disabled:opacity-40 sm:order-2 sm:w-auto"
                  >
                    {updateMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
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
              className="fixed inset-0 z-[120] flex min-h-[100dvh] items-center justify-center overflow-y-auto px-4 py-6 modal-scrim sm:p-4"
              onClick={() => setTestModalRow(null)}
            >
              <div
                className="glass-panel w-full max-w-md space-y-4 rounded-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5 sm:pb-5"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 pr-2">
                    <h3 className="text-base font-semibold">Test connection</h3>
                    <p className="mt-1 break-words text-xs text-muted-foreground">
                      {testModalRow.name} ({testModalRow.sshUser}@{testModalRow.host})
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTestModalRow(null)}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                    aria-label="Close test dialog"
                  >
                    <X className="size-4" />
                  </button>
                </div>

                <div className="space-y-2">
                  <button
                    type="button"
                    disabled={
                      !allowOrgTest ||
                      !allowOrgTerminal ||
                      testSshMut.isPending ||
                      testMut.isPending
                    }
                    onClick={() => testSshMut.mutate(remoteServerRouteId(testModalRow))}
                    className="btn-secondary inline-flex min-h-11 w-full items-center justify-center gap-2 px-3 py-2 text-sm disabled:opacity-40 sm:min-h-0"
                    title="SSH only: ssh2 + shell (echo + uname). Does not use Docker."
                  >
                    {testSshMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                    SSH
                  </button>
                  <button
                    type="button"
                    disabled={
                      !allowOrgTest || !allowOrgDocker || testMut.isPending || testSshMut.isPending
                    }
                    onClick={() => testMut.mutate(remoteServerRouteId(testModalRow))}
                    className="btn-secondary inline-flex min-h-11 w-full items-center justify-center gap-2 px-3 py-2 text-sm disabled:opacity-40 sm:min-h-0"
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
      {typeof document !== "undefined" && terminalModalRow
        ? createPortal(
            <div
              className="fixed inset-0 z-[120] flex min-h-[100dvh] items-center justify-center overflow-y-auto px-3 py-4 modal-scrim sm:p-4"
              onClick={() => {
                setTerminalModalRow(null);
              }}
            >
              <div
                className="glass-panel flex max-h-[min(92dvh,calc(100dvh-2rem))] w-full max-w-4xl flex-col space-y-3 rounded-2xl p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:max-h-[90vh] sm:p-5 sm:pb-5"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 pr-2">
                    <h3 className="text-base font-semibold">Remote Terminal</h3>
                    <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground sm:text-xs">
                      {`${terminalModalRow.sshUser}@${terminalModalRow.host}${terminalModalRow.port !== 22 ? `:${terminalModalRow.port}` : ""}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setTerminalModalRow(null);
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-slate-100 dark:hover:bg-white/10 hover:text-foreground"
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
                    className="h-[52dvh] min-h-[220px] w-full max-h-[60dvh] rounded-lg border border-border/50 bg-slate-100 dark:bg-zinc-950 overflow-hidden sm:h-[62vh] sm:max-h-none sm:min-h-[360px]"
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
