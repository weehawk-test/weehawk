"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Globe, Loader2, Mail, Minus, Plus, Server, Settings2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import {
  fetchRemoteServers,
  updateRemoteServerApi,
  type RemoteServerRow,
} from "@/lib/remote-servers-api";
import { fetchTraefikSettings, updateTraefikSettings } from "@/lib/traefik-api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { filterSshDeployServers } from "@/lib/loopback-ssh-host";

const REMOTE_SERVERS_QK = ["remote-servers"] as const;
const TRAEFIK_SETTINGS_QK = ["traefik", "settings"] as const;

const DEFAULT_ACME_PLACEHOLDER = "admin@example.com";

function isValidEmailShape(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

/** Saved ACME email allows domain editing: real address, not the default placeholder. */
function isLetsEncryptEmailConfigured(acmeEmail: string | null | undefined): boolean {
  const t = (acmeEmail ?? "").trim();
  if (!t || !isValidEmailShape(t)) return false;
  if (t.toLowerCase() === DEFAULT_ACME_PLACEHOLDER.toLowerCase()) return false;
  return true;
}

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
  const [dirty, setDirty] = useState(false);
  const skipNextBaselineSync = useRef(false);

  useEffect(() => {
    if (skipNextBaselineSync.current) {
      skipNextBaselineSync.current = false;
      return;
    }
    if (!dirty) setRows(initialRows);
  }, [initialRows, dirty]);

  const currentHosts = useMemo(() => rowsToHosts(rows), [rows]);
  const isDirty = dirty || !hostsEqual(currentHosts, baselineHosts);

  const { mutate, isPending } = useMutation({
    mutationFn: async (domainsJson: string | null) =>
      updateRemoteServerApi(accessToken, server.id, { domainsJson }),
    onSuccess: async (row) => {
      await qc.invalidateQueries({ queryKey: REMOTE_SERVERS_QK });
      const nextHosts = domainsJsonToHosts(row.domainsJson);
      skipNextBaselineSync.current = true;
      setRows(hostsToRows(nextHosts));
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

export function DeployDomainsClient() {
  const { accessToken } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const traefikQ = useQuery({
    queryKey: TRAEFIK_SETTINGS_QK,
    queryFn: () => fetchTraefikSettings(accessToken ?? ""),
    enabled: Boolean(accessToken),
  });

  const q = useQuery({
    queryKey: REMOTE_SERVERS_QK,
    queryFn: () => fetchRemoteServers(accessToken ?? ""),
    enabled: Boolean(accessToken),
  });

  const [acmeEmailLocal, setAcmeEmailLocal] = useState("");
  const [acmeEmailDirty, setAcmeEmailDirty] = useState(false);

  const [acmeOpen, setAcmeOpen] = useState(false);
  const [certResolver, setCertResolver] = useState("letsencrypt");
  const [acmeStorage, setAcmeStorage] = useState("/var/www/weehawk/traefik/data/acme.json");
  const [httpEp, setHttpEp] = useState("web");
  const [httpsEp, setHttpsEp] = useState("websecure");
  const [redirectHttp, setRedirectHttp] = useState(true);
  const [traefikImage, setTraefikImage] = useState("traefik:v2.11");
  const [acmeAdvDirty, setAcmeAdvDirty] = useState(false);

  useEffect(() => {
    if (traefikQ.data != null && !acmeEmailDirty) {
      setAcmeEmailLocal(traefikQ.data.acmeEmail ?? "");
    }
  }, [traefikQ.data, acmeEmailDirty]);

  useEffect(() => {
    if (traefikQ.data != null && !acmeAdvDirty) {
      setCertResolver(traefikQ.data.certResolverName ?? "letsencrypt");
      setAcmeStorage(traefikQ.data.acmeStorageHostPath ?? "/var/www/weehawk/traefik/data/acme.json");
      setHttpEp(traefikQ.data.httpEntrypoint ?? "web");
      setHttpsEp(traefikQ.data.httpsEntrypoint ?? "websecure");
      setRedirectHttp(traefikQ.data.redirectHttpToHttps ?? true);
      setTraefikImage(traefikQ.data.traefikImage ?? "traefik:v2.11");
    }
  }, [traefikQ.data, acmeAdvDirty]);

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
    if (t.toLowerCase() === DEFAULT_ACME_PLACEHOLDER.toLowerCase()) {
      toast({
        title: "Use your real email",
        description: `${DEFAULT_ACME_PLACEHOLDER} is only a placeholder.`,
        variant: "destructive",
      });
      return;
    }
    emailMutation.mutate(t);
  };

  const acmeAdvMutation = useMutation({
    mutationFn: (patch: Parameters<typeof updateTraefikSettings>[1]) =>
      updateTraefikSettings(accessToken ?? "", patch),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: TRAEFIK_SETTINGS_QK });
      setAcmeAdvDirty(false);
      toast({ title: "ACME settings saved" });
    },
    onError: (e: Error) => {
      toast({ title: "Could not save ACME settings", description: e.message, variant: "destructive" });
    },
  });

  const onSaveAcmeAdv = () => {
    if (!certResolver.trim() || !acmeStorage.trim() || !httpEp.trim() || !httpsEp.trim() || !traefikImage.trim()) {
      toast({ title: "All fields are required", variant: "destructive" });
      return;
    }
    acmeAdvMutation.mutate({
      certResolverName: certResolver.trim(),
      acmeStorageHostPath: acmeStorage.trim(),
      httpEntrypoint: httpEp.trim(),
      httpsEntrypoint: httpsEp.trim(),
      redirectHttpToHttps: redirectHttp,
      traefikImage: traefikImage.trim(),
    });
  };

  const isAcmeAdvChanged = traefikQ.data != null && (
    certResolver.trim() !== (traefikQ.data.certResolverName ?? "") ||
    acmeStorage.trim() !== (traefikQ.data.acmeStorageHostPath ?? "") ||
    httpEp.trim() !== (traefikQ.data.httpEntrypoint ?? "") ||
    httpsEp.trim() !== (traefikQ.data.httpsEntrypoint ?? "") ||
    redirectHttp !== (traefikQ.data.redirectHttpToHttps ?? true) ||
    traefikImage.trim() !== (traefikQ.data.traefikImage ?? "")
  );

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
                    acmeEmailLocal.trim().toLowerCase() === DEFAULT_ACME_PLACEHOLDER.toLowerCase()
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

      {/* ── Advanced ACME / Traefik settings ── */}
      <section className="rounded-2xl border border-white/10 bg-gradient-to-br from-card/50 to-card/30 p-1 shadow-sm shadow-black/20 max-w-3xl">
        <div className="rounded-[0.875rem] bg-card/50">
          <button
            type="button"
            onClick={() => setAcmeOpen(!acmeOpen)}
            className="flex w-full items-center gap-3 p-5 text-left"
          >
            <div className="rounded-xl bg-primary/15 border border-primary/25 p-2.5 shrink-0">
              <Settings2 className="size-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-sm tracking-tight">Advanced ACME / Traefik</h2>
              <p className="text-xs text-muted-foreground">
                Cert resolver, entrypoints, image, and redirect settings.
              </p>
            </div>
            <ChevronDown
              className={cn(
                "size-4 text-muted-foreground shrink-0 transition-transform duration-200",
                acmeOpen && "rotate-180",
              )}
            />
          </button>

          {acmeOpen && (
            <div className="px-5 pb-5 space-y-4 max-w-xl">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground/80">Cert Resolver Name</label>
                <Input
                  value={certResolver}
                  onChange={(e) => { setAcmeAdvDirty(true); setCertResolver(e.target.value); }}
                  placeholder="letsencrypt"
                  className="max-w-md"
                  spellCheck={false}
                />
                <p className="text-[11px] text-muted-foreground">
                  Name used in Traefik labels: <code className="text-[10px]">tls.certresolver={"<"}name{">"}</code>
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground/80">ACME Storage Host Path</label>
                <Input
                  value={acmeStorage}
                  onChange={(e) => { setAcmeAdvDirty(true); setAcmeStorage(e.target.value); }}
                  placeholder="/var/www/weehawk/traefik/data/acme.json"
                  className="max-w-md font-mono text-xs"
                  spellCheck={false}
                />
                <p className="text-[11px] text-muted-foreground">
                  File on the host mounted to <code className="text-[10px]">/acme.json</code> inside Traefik.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground/80">Traefik Image</label>
                <Input
                  value={traefikImage}
                  onChange={(e) => { setAcmeAdvDirty(true); setTraefikImage(e.target.value); }}
                  placeholder="traefik:v2.11"
                  className="max-w-md font-mono text-xs"
                  spellCheck={false}
                />
              </div>

              <div className="grid grid-cols-2 gap-4 max-w-md">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground/80">HTTP Entrypoint</label>
                  <Input
                    value={httpEp}
                    onChange={(e) => { setAcmeAdvDirty(true); setHttpEp(e.target.value); }}
                    placeholder="web"
                    className="font-mono text-xs"
                    spellCheck={false}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground/80">HTTPS Entrypoint</label>
                  <Input
                    value={httpsEp}
                    onChange={(e) => { setAcmeAdvDirty(true); setHttpsEp(e.target.value); }}
                    placeholder="websecure"
                    className="font-mono text-xs"
                    spellCheck={false}
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <Switch
                  id="redirect-http"
                  checked={redirectHttp}
                  onCheckedChange={(v) => { setAcmeAdvDirty(true); setRedirectHttp(v); }}
                />
                <Label htmlFor="redirect-http" className="text-xs cursor-pointer">
                  Redirect HTTP to HTTPS
                </Label>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 disabled:opacity-40 disabled:pointer-events-none"
                  disabled={acmeAdvMutation.isPending || !isAcmeAdvChanged}
                  onClick={onSaveAcmeAdv}
                >
                  {acmeAdvMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
                </button>
                {isAcmeAdvChanged && (
                  <span className="text-[11px] text-amber-500/80">Unsaved changes</span>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {!domainsUnlocked && traefikQ.data != null && (
        <p className="text-sm text-amber-600/90 dark:text-amber-400/85 max-w-xl">
          Save your email above first.
        </p>
      )}

      {deployServers.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-card/30 p-8 text-center text-sm text-muted-foreground">
          No deploy servers.{" "}
          <Link href="/remote-server" className="text-primary hover:underline">
            Add one
          </Link>
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
