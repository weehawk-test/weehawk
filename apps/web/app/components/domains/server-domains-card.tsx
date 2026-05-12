"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Minus, Plus, Server } from "lucide-react";
import {
  enqueueRemoteTraefikRedeployApi,
  updateRemoteServerApi,
  type RemoteServerRow,
} from "@/lib/remote-servers-api";
import { updateTraefikSettings } from "@/lib/traefik-api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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
  if (hosts.length === 0) {
    if (previousRaw?.trim()) {
      try {
        const prev = JSON.parse(previousRaw) as unknown;
        if (prev && typeof prev === "object" && !Array.isArray(prev)) {
          const o = prev as Record<string, unknown>;
          if (typeof o.weehawkBootstrap === "string" && o.weehawkBootstrap.trim()) {
            return JSON.stringify({ ...o, domains: [] });
          }
        }
      } catch {
        /* fall through */
      }
    }
    return null;
  }
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

const isSelfHosted =
  (process.env.NEXT_PUBLIC_INSTANCE_MODE || "cloud").trim().toLowerCase() === "self-hosted";

export function ServerDomainsCard({
  server,
  accessToken,
  domainsEnabled,
  remoteServersQueryKey,
  orgName,
}: {
  server: RemoteServerRow;
  accessToken: string;
  domainsEnabled: boolean;
  remoteServersQueryKey: readonly unknown[];
  orgName?: string | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const canEditSites = domainsEnabled;
  const baselineHosts = useMemo(() => domainsJsonToHosts(server.domainsJson), [server.domainsJson]);
  const initialRows = useMemo(() => hostsToRows(baselineHosts), [baselineHosts]);

  const [acmeEmail, setAcmeEmail] = useState(server.acmeEmail ?? "");
  const [primaryDomain, setPrimaryDomain] = useState(() => {
    try {
      const parsed = server.domainsJson ? JSON.parse(server.domainsJson) : null;
      return (parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof parsed.primaryDomain === "string")
        ? parsed.primaryDomain
        : "";
    } catch { return ""; }
  });

  useEffect(() => {
    setAcmeEmail(server.acmeEmail ?? "");
  }, [server.acmeEmail]);

  useEffect(() => {
    try {
      const parsed = server.domainsJson ? JSON.parse(server.domainsJson) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof parsed.primaryDomain === "string") {
        setPrimaryDomain(parsed.primaryDomain);
      }
    } catch { /* ignore */ }
  }, [server.domainsJson]);

  const serverSettingsMut = useMutation({
    mutationFn: async () => {
      const raw = server.domainsJson?.trim() || null;
      let base: Record<string, unknown> = {};
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            base = parsed as Record<string, unknown>;
          }
        } catch { /* ignore */ }
      }
      const pd = primaryDomain.trim();
      const next = { ...base, primaryDomain: pd };
      const serverId = server.publicId?.trim() || String(server.id);
      const updated = await updateRemoteServerApi(accessToken, serverId, {
        acmeEmail: acmeEmail.trim(),
        domainsJson: JSON.stringify(next),
      });
      await updateTraefikSettings(accessToken, {
        acmeEmail: acmeEmail.trim(),
        platformDomain: pd,
      }).catch(() => undefined);
      if (server.hasPrivateKey && server.serverRole === "deploy") {
        await enqueueRemoteTraefikRedeployApi(accessToken, serverId).catch(() => undefined);
      }
      return updated;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: remoteServersQueryKey });
      const hasKey = server.hasPrivateKey && server.serverRole === "deploy";
      toast({
        title: "Server settings saved",
        description: hasKey
          ? "Traefik redeploy queued — changes will apply shortly."
          : undefined,
      });
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const serverSettingsDirty = (() => {
    if (acmeEmail.trim() !== (server.acmeEmail ?? "")) return true;
    try {
      const parsed = server.domainsJson ? JSON.parse(server.domainsJson) : null;
      const stored = (parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof parsed.primaryDomain === "string")
        ? parsed.primaryDomain : "";
      if (primaryDomain.trim() !== stored) return true;
    } catch { return true; }
    return false;
  })();

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
      updateRemoteServerApi(accessToken, server.publicId?.trim() || String(server.id), { domainsJson }),
    onSuccess: async (row) => {
      await qc.invalidateQueries({ queryKey: remoteServersQueryKey });
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
    if (!canEditSites) return;
    mutate(hostsToStoredJson(currentHosts, server.domainsJson));
  }, [canEditSites, mutate, currentHosts, server.domainsJson]);

  const updateRow = (id: number, value: string) => {
    if (!canEditSites) return;
    setDirty(true);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, value } : r)));
  };

  const addRow = () => {
    if (!canEditSites) return;
    setDirty(true);
    setRows((prev) => [...prev, { id: newRowId(), value: "" }]);
  };

  const removeRow = (index: number) => {
    if (!canEditSites) return;
    setDirty(true);
    setRows((prev) => {
      if (prev.length <= 1) return [{ ...prev[0], value: "" }];
      return prev.filter((_, i) => i !== index);
    });
  };

  return (
    <div
      className="rounded-2xl border border-white/10 bg-gradient-to-br from-card/50 to-card/30 p-1 shadow-sm shadow-black/20"
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

        {isSelfHosted && orgName === "Root Org" && (
          <div className="space-y-4">
            <p className="text-xs font-medium text-foreground/80 tracking-wide uppercase">Server settings</p>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">
                Certificate email (For Let&apos;s Encrypt)
              </label>
              <Input
                type="email"
                value={acmeEmail}
                onChange={(e) => setAcmeEmail(e.target.value)}
                placeholder="you@weehawk.io"
                className="h-9 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">
                Primary domain
              </label>
              <Input
                type="text"
                value={primaryDomain}
                onChange={(e) => setPrimaryDomain(e.target.value)}
                placeholder="weehawk.io"
                className="h-9 text-sm"
                spellCheck={false}
              />
              <p className="text-[11px] text-muted-foreground/70">
                The main domain where this Weehawk instance is accessible.
              </p>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                className="btn-primary inline-flex items-center justify-center gap-1.5 text-sm disabled:pointer-events-none disabled:opacity-40"
                disabled={serverSettingsMut.isPending || !serverSettingsDirty}
                onClick={() => serverSettingsMut.mutate()}
              >
                {serverSettingsMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
              </button>
            </div>

            <div className="border-t border-border/40" />
          </div>
        )}

        <div className={cn("space-y-3", !canEditSites && "opacity-55 pointer-events-none select-none")}>
          <p className="text-xs font-medium text-foreground/80 tracking-wide uppercase">Sites</p>
          <div
            className={cn(
              "rounded-xl border border-border/50 bg-muted/30 p-2 space-y-1.5",
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
                  disabled={!canEditSites}
                  className={cn(
                    "h-9 flex-1 min-w-0 border-0 bg-transparent shadow-none",
                    "text-sm placeholder:text-muted-foreground/55",
                    "focus-visible:ring-0 focus-visible:ring-offset-0",
                  )}
                  spellCheck={false}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={!canEditSites}
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

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              disabled={!canEditSites}
              onClick={addRow}
              className="btn-secondary inline-flex h-9 items-center gap-2 px-3 text-sm"
            >
              <Plus className="size-3.5 stroke-[2.5]" />
              Add domain field
            </button>
            <button
              type="button"
              className="btn-primary inline-flex items-center justify-center gap-1.5 text-sm disabled:pointer-events-none disabled:opacity-40"
              disabled={!canEditSites || isPending || !isDirty}
              onClick={onSave}
            >
              {isPending ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
