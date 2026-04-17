"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Loader2, Mail, Minus, Plus, Server } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import {
  fetchRemoteServers,
  updateRemoteServerApi,
  type RemoteServerRow,
} from "@/lib/remote-servers-api";
import {
  fetchTraefikSettings,
  updateTraefikSettings,
  type TraefikSettingsPayload,
} from "@/lib/traefik-api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { filterSshDeployServers } from "@/lib/loopback-ssh-host";
import {
  isBlockedAcmeContactEmail,
  isLetsEncryptEmailConfigured,
  isValidEmailShape,
} from "@/lib/traefik-acme-email";

const REMOTE_SERVERS_QK = ["remote-servers"] as const;
const TRAEFIK_SETTINGS_QK = ["traefik", "settings"] as const;

let rowIdSeq = 0;
function newRowId(): number {
  return ++rowIdSeq;
}

type DomainRow = { id: number; value: string };

function extractDomainLabels(parsed: unknown): string[] {
  if (parsed == null) return [];
  if (Array.isArray(parsed)) {
    return parsed
      .filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
      .map((s) => s.trim());
  }
  if (typeof parsed === "object" && !Array.isArray(parsed)) {
    const o = parsed as Record<string, unknown>;
    if (Array.isArray(o.domains)) {
      return o.domains
        .filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
        .map((s) => s.trim());
    }
    const out: string[] = [];
    for (const v of Object.values(o)) {
      if (typeof v === "string" && v.trim()) out.push(v.trim());
    }
    return out;
  }
  return [];
}

function domainsJsonToHosts(raw: string | null): string[] {
  if (raw == null || !String(raw).trim()) return [];
  try {
    return extractDomainLabels(JSON.parse(raw));
  } catch {
    return [];
  }
}

function hostsToRows(hosts: string[]): DomainRow[] {
  if (hosts.length === 0) return [{ id: newRowId(), value: "" }];
  return hosts.map((value) => ({ id: newRowId(), value }));
}

function rowsToHosts(rows: DomainRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { value } of rows) {
    const p = value.trim();
    if (!p) continue;
    const k = p.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(p);
    }
  }
  return out;
}

function hostsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function hostsToStoredJson(hosts: string[], previousRaw: string | null): string | null {
  if (hosts.length === 0) return null;
  if (previousRaw?.trim()) {
    try {
      const prev = JSON.parse(previousRaw) as unknown;
      if (prev && typeof prev === "object" && !Array.isArray(prev)) {
        return JSON.stringify({ ...(prev as Record<string, unknown>), domains: hosts });
      }
    } catch {
      /* fall through */
    }
  }
  return JSON.stringify(hosts);
}

function ServerDomainsCard({
  server,
  accessToken,
  domainsEnabled,
}: {
  server: RemoteServerRow;
  accessToken: string;
  domainsEnabled: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const baselineHosts = useMemo(() => domainsJsonToHosts(server.domainsJson), [server.domainsJson]);
  const initialRows = useMemo(() => hostsToRows(baselineHosts), [baselineHosts]);

  const [rows, setRows] = useState<DomainRow[]>(initialRows);
  const [savedHosts, setSavedHosts] = useState<string[]>(baselineHosts);
  const [dirty, setDirty] = useState(false);
  const skipNextBaselineSync = useRef(false);

  useEffect(() => {
    if (skipNextBaselineSync.current) {
      skipNextBaselineSync.current = false;
      return;
    }
    if (!dirty) {
      setRows(initialRows);
      setSavedHosts(baselineHosts);
    }
  }, [initialRows, baselineHosts, dirty]);

  const currentHosts = useMemo(() => rowsToHosts(rows), [rows]);
  const isDirty = dirty || !hostsEqual(currentHosts, savedHosts);

  const { mutate, isPending } = useMutation({
    mutationFn: async (domainsJson: string | null) =>
      updateRemoteServerApi(accessToken, server.id, { domainsJson }),
    onSuccess: async (row) => {
      await qc.invalidateQueries({ queryKey: REMOTE_SERVERS_QK });
      const nextHosts = domainsJsonToHosts(row.domainsJson);
      skipNextBaselineSync.current = true;
      setRows(hostsToRows(nextHosts));
      setSavedHosts(nextHosts);
      setDirty(false);
      toast({ title: "Domains saved", description: server.name });
    },
    onError: (e: Error) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  const onSave = useCallback(() => {
    if (!domainsEnabled) return;
    mutate(hostsToStoredJson(currentHosts, server.domainsJson));
  }, [domainsEnabled, mutate, currentHosts, server.domainsJson]);

  const updateRow = (id: number, value: string) => {
    if (!domainsEnabled) return;
    setDirty(true);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, value } : r)));
  };

  const addRow = () => {
    if (!domainsEnabled) return;
    setDirty(true);
    setRows((prev) => [...prev, { id: newRowId(), value: "" }]);
  };

  const removeRow = (index: number) => {
    if (!domainsEnabled) return;
    setDirty(true);
    setRows((prev) => {
      if (prev.length <= 1) return [{ ...prev[0], value: "" }];
      return prev.filter((_, i) => i !== index);
    });
  };

  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10 bg-gradient-to-br from-card/50 to-card/30 p-1 shadow-sm shadow-black/20",
        !domainsEnabled && "opacity-55 pointer-events-none select-none",
      )}
    >
      <div className="rounded-[0.875rem] bg-card/50 p-5 space-y-5">
        <div className="flex items-start gap-3 min-w-0">
          <div className="rounded-xl bg-primary/15 border border-primary/25 p-2.5 shrink-0 shadow-inner shadow-primary/5">
            <Server className="size-5 text-primary" />
          </div>
          <div className="min-w-0 pt-0.5">
            <h2 className="font-semibold text-base tracking-tight truncate">{server.name}</h2>
            <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">
              {server.sshUser}@{server.host}:{server.port}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-xs font-medium text-foreground/80 tracking-wide uppercase">Sites</p>

          <div
            className={cn(
              "rounded-xl border border-border/50 bg-muted/30 p-2 space-y-1.5 max-w-xl",
              "ring-1 ring-black/5 dark:ring-white/5",
            )}
          >
            {rows.map((row, index) => (
              <div
                key={row.id}
                className={cn(
                  "group flex items-stretch gap-2 rounded-lg px-1.5 py-1",
                  "bg-background/50 border border-border/40",
                  "shadow-sm shadow-black/[0.03]",
                  "transition-all duration-200",
                  "hover:border-border hover:bg-background/70",
                  "focus-within:border-primary/35 focus-within:ring-2 focus-within:ring-primary/15 focus-within:bg-background/80",
                )}
              >
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-md",
                    "bg-muted/70 text-[11px] font-semibold text-muted-foreground tabular-nums",
                    "border border-border/30",
                  )}
                >
                  {index + 1}
                </span>
                <Input
                  value={row.value}
                  onChange={(e) => updateRow(row.id, e.target.value)}
                  placeholder="app.example.com"
                  disabled={!domainsEnabled}
                  className={cn(
                    "flex-1 min-w-0 h-9 border-0 bg-transparent shadow-none",
                    "text-sm placeholder:text-muted-foreground/55",
                    "focus-visible:ring-0 focus-visible:ring-offset-0",
                  )}
                  spellCheck={false}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={!domainsEnabled}
                  className={cn(
                    "h-9 w-9 shrink-0 self-center rounded-lg",
                    "border-border/60 bg-background/80 text-muted-foreground",
                    "hover:bg-destructive/10 hover:text-destructive hover:border-destructive/25",
                    "transition-colors duration-200",
                  )}
                  onClick={() => removeRow(index)}
                  aria-label={rows.length <= 1 ? "Clear domain field" : "Remove domain field"}
                  title={rows.length <= 1 ? "Clear" : "Remove"}
                >
                  <Minus className="size-4 stroke-[2.25]" />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 max-w-xl">
            <button
              type="button"
              className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 disabled:opacity-40 disabled:pointer-events-none"
              disabled={!domainsEnabled || isPending || !isDirty}
              onClick={onSave}
            >
              {isPending ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
            </button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!domainsEnabled}
              onClick={addRow}
              className={cn(
                "h-9 px-3 gap-2 text-muted-foreground hover:text-foreground",
                "hover:bg-primary/10 rounded-lg border border-transparent hover:border-primary/20",
              )}
            >
              <span className="flex size-6 items-center justify-center rounded-md bg-primary/15 text-primary">
                <Plus className="size-3.5 stroke-[2.5]" />
              </span>
              Add domain field
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DeployDomainsClient({
  initialRemoteServers,
  initialTraefikSettings,
}: {
  initialRemoteServers?: RemoteServerRow[];
  initialTraefikSettings?: TraefikSettingsPayload | null;
}) {
  const { accessToken } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const hasInitialRemoteServers = initialRemoteServers !== undefined;
  const hasInitialTraefik = initialTraefikSettings !== undefined;

  const traefikQ = useQuery({
    queryKey: TRAEFIK_SETTINGS_QK,
    queryFn: () => fetchTraefikSettings(accessToken ?? ""),
    enabled: Boolean(accessToken) && !hasInitialTraefik,
    initialData: initialTraefikSettings ?? undefined,
    staleTime: hasInitialTraefik ? Infinity : 10_000,
    refetchOnMount: hasInitialTraefik ? false : undefined,
  });

  const q = useQuery({
    queryKey: REMOTE_SERVERS_QK,
    queryFn: () => fetchRemoteServers(accessToken ?? ""),
    enabled: Boolean(accessToken) && !hasInitialRemoteServers,
    initialData: initialRemoteServers,
    staleTime: hasInitialRemoteServers ? Infinity : 10_000,
    refetchOnMount: hasInitialRemoteServers ? false : undefined,
  });

  const [acmeEmailLocal, setAcmeEmailLocal] = useState(
    initialTraefikSettings?.acmeEmail ?? "",
  );
  const [acmeEmailDirty, setAcmeEmailDirty] = useState(false);

  useEffect(() => {
    if (traefikQ.data != null && !acmeEmailDirty) {
      setAcmeEmailLocal(traefikQ.data.acmeEmail ?? "");
    }
  }, [traefikQ.data, acmeEmailDirty]);

  const emailMutation = useMutation({
    mutationFn: (email: string) =>
      updateTraefikSettings(accessToken ?? "", { acmeEmail: email.trim() }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: TRAEFIK_SETTINGS_QK });
      setAcmeEmailDirty(false);
      toast({ title: "Email saved" });
    },
    onError: (e: Error) => {
      toast({ title: "Could not save email", description: e.message, variant: "destructive" });
    },
  });

  const onSaveAcmeEmail = () => {
    const t = acmeEmailLocal.trim();
    if (!isValidEmailShape(t)) {
      toast({ title: "Enter a valid email address", variant: "destructive" });
      return;
    }
    if (isBlockedAcmeContactEmail(t)) {
      toast({
        title: "Use your real email",
        description: "That address is a placeholder and cannot be used for Let's Encrypt.",
        variant: "destructive",
      });
      return;
    }
    emailMutation.mutate(t);
  };

  const savedAcme = traefikQ.data?.acmeEmail ?? "";
  const acmeEmailChanged =
    traefikQ.data != null && acmeEmailLocal.trim() !== savedAcme.trim();
  const domainsUnlocked = isLetsEncryptEmailConfigured(savedAcme);

  const deployServers = useMemo(
    () => filterSshDeployServers(q.data ?? []),
    [q.data],
  );

  if (!accessToken) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  if (q.isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="size-6 animate-spin" />
        Loading servers…
      </div>
    );
  }

  if (q.isError) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-red-200 text-sm">
        {(q.error as Error).message}
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/15 border border-primary/25 p-2.5 shadow-sm shadow-primary/10">
            <Globe className="size-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Domains</h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Save your certificate email, then list site addresses per server.{" "}
              <Link href="/remote-server" className="text-primary hover:underline">
                Servers
              </Link>
            </p>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-white/10 bg-gradient-to-br from-card/50 to-card/30 p-1 shadow-sm shadow-black/20">
        <div className="rounded-[0.875rem] bg-card/50 p-5 space-y-4 max-w-xl">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/15 border border-primary/25 p-2.5 shrink-0">
              <Mail className="size-5 text-primary" />
            </div>
            <div className="min-w-0 space-y-1">
              <h2 className="font-semibold text-sm tracking-tight">Certificate email</h2>
              <p className="text-xs text-muted-foreground">
                For Let&apos;s Encrypt notices. Save it before editing addresses below.
              </p>
            </div>
          </div>

          {traefikQ.isLoading && !traefikQ.data ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="size-4 animate-spin" />
              Loading settings…
            </div>
          ) : traefikQ.isError ? (
            <p className="text-sm text-destructive">{(traefikQ.error as Error).message}</p>
          ) : (
            <>
              <div className="space-y-1.5">
                <label htmlFor="domains-acme-email" className="text-xs font-medium text-foreground/80">
                  Email
                </label>
                <Input
                  id="domains-acme-email"
                  type="email"
                  autoComplete="email"
                  value={acmeEmailLocal}
                  onChange={(e) => {
                    setAcmeEmailDirty(true);
                    setAcmeEmailLocal(e.target.value);
                  }}
                  placeholder="you@example.com"
                  className="max-w-md"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 disabled:opacity-40 disabled:pointer-events-none"
                  disabled={
                    emailMutation.isPending ||
                    !acmeEmailChanged ||
                    !isValidEmailShape(acmeEmailLocal) ||
                    isBlockedAcmeContactEmail(acmeEmailLocal)
                  }
                  onClick={onSaveAcmeEmail}
                >
                  {emailMutation.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    "Save email"
                  )}
                </button>
                {domainsUnlocked && (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400/90">Ready</span>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {!domainsUnlocked && traefikQ.data != null && (
        <p className="text-sm text-amber-600/90 dark:text-amber-400/85 max-w-xl">
          Save your email above first.
        </p>
      )}

      {deployServers.length === 0 ? (
        <div
          className="rounded-2xl border border-border/70 bg-muted/20 px-6 py-8 text-center dark:border-white/10 dark:bg-card/40 dark:shadow-sm"
          role="status"
        >
          <p className="text-sm text-foreground">
            <span className="text-muted-foreground">No deploy servers.</span>{" "}
            <Link
              href="/remote-server"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              Add one
            </Link>
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {deployServers.map((s) => (
            <ServerDomainsCard
              key={s.id}
              server={s}
              accessToken={accessToken}
              domainsEnabled={domainsUnlocked}
            />
          ))}
        </div>
      )}
    </div>
  );
}
