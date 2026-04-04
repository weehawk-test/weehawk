"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RadioTower, Loader2, Copy, Check } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import {
  fetchTraefikSettings,
  updateTraefikSettings,
  type TraefikSettingsPayload,
} from "@/lib/traefik-api";
import { useToast } from "@/hooks/use-toast";

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const empty = !text.trim();
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/10 bg-white/[0.03]">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <button
          type="button"
          disabled={empty}
          onClick={() => {
            if (empty) return;
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-40 disabled:pointer-events-none"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="text-[11px] leading-relaxed p-3 max-h-64 overflow-auto font-mono text-zinc-300 whitespace-pre-wrap break-all">
        {empty ? "— Save a domain below to generate this file —" : text}
      </pre>
    </div>
  );
}

export function TraefikSettingsClient() {
  const { accessToken } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["traefik", "settings"],
    queryFn: () => fetchTraefikSettings(accessToken ?? ""),
    enabled: Boolean(accessToken),
  });

  const [acmeEmail, setAcmeEmail] = useState("");
  const [platformDomain, setPlatformDomain] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (q.data && !dirty) {
      setAcmeEmail(q.data.acmeEmail);
      setPlatformDomain(q.data.platformDomain ?? "");
    }
  }, [q.data, dirty]);

  const mut = useMutation({
    mutationFn: (patch: { acmeEmail: string; platformDomain: string }) =>
      updateTraefikSettings(accessToken ?? "", patch),
    onSuccess: (data) => {
      qc.setQueryData(["traefik", "settings"], data);
      setAcmeEmail(data.acmeEmail);
      setPlatformDomain(data.platformDomain ?? "");
      setDirty(false);
      toast({ title: "Traefik settings saved" });
    },
    onError: (e: Error) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  if (!accessToken) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  if (q.isLoading || !q.data) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="size-6 animate-spin" />
        Loading Traefik settings…
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

  const previews: TraefikSettingsPayload = q.data;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 border border-primary/20 p-2.5">
            <RadioTower className="size-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Traefik</h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Enter your Let&apos;s Encrypt email and the domain where you want the Weehawk UI (port{" "}
              <span className="font-mono text-zinc-300">3000</span> on this server). Copy the generated files, deploy
              Traefik, then put the dynamic YAML on disk as shown. Project{" "}
              <Link href="/projects" className="text-primary hover:underline">
                Domains
              </Link>{" "}
              for apps still use the <span className="font-mono">weehawk</span> overlay.
            </p>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-white/10 bg-card/40 p-6 space-y-5 max-w-xl">
        <label className="block space-y-1.5">
          <span className="text-xs text-muted-foreground">Email (Let&apos;s Encrypt)</span>
          <input
            className="input-field w-full"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={acmeEmail}
            onChange={(e) => {
              setDirty(true);
              setAcmeEmail(e.target.value);
            }}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs text-muted-foreground">Weehawk UI domain</span>
          <input
            className="input-field w-full font-mono text-sm"
            placeholder="weehawk.example.com"
            value={platformDomain}
            onChange={(e) => {
              setDirty(true);
              setPlatformDomain(e.target.value);
            }}
          />
          <span className="text-[11px] text-muted-foreground block">
            HTTPS for this host will forward to Weehawk on this machine at port 3000. Leave empty if you only use
            IP:port locally.
          </span>
        </label>
        <p className="text-[11px] text-muted-foreground">
          One-time on the manager:{" "}
          <code className="text-zinc-400 text-[10px]">docker network create -d overlay weehawk</code>
        </p>

        <button
          type="button"
          disabled={mut.isPending || !acmeEmail.trim()}
          className="btn-primary"
          onClick={() =>
            mut.mutate({
              acmeEmail: acmeEmail.trim(),
              platformDomain: platformDomain.trim(),
            })
          }
        >
          {mut.isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Saving…
            </>
          ) : (
            "Save"
          )}
        </button>
      </section>

      <div className="space-y-4">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
          Copy for your server
        </h2>
        <p className="text-xs text-muted-foreground -mt-2 max-w-2xl">
          When a UI domain is set, the Compose stack adds the file provider and a volume for{" "}
          <span className="font-mono">/etc/traefik/dynamic</span>. Save the third file into that folder on the host.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <CopyBlock label="Docker Compose (Traefik)" text={previews.generatedStackCompose} />
          <CopyBlock label="traefik.yml (reference)" text={previews.generatedStaticConfig} />
        </div>
        <CopyBlock
          label="dynamic/weehawk-platform.yml (Weehawk UI → :3000)"
          text={previews.generatedPlatformDynamicConfig}
        />
      </div>
    </div>
  );
}
