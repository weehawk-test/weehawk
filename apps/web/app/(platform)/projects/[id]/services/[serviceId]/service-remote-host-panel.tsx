"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Server } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { fetchRemoteServers } from "@/lib/remote-servers-api";
import type { Service } from "@/lib/schema";
import { useUpdateService } from "@/hooks/use-services";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";

export function ServiceRemoteHostPanel({ service }: { service: Service }) {
  const { accessToken } = useAuth();
  const { toast } = useToast();
  const updateService = useUpdateService();

  const q = useQuery({
    queryKey: ["remote-servers"],
    queryFn: () => fetchRemoteServers(accessToken ?? ""),
    enabled: Boolean(accessToken),
  });

  const [value, setValue] = useState<string>(() =>
    service.remoteServerId != null ? String(service.remoteServerId) : "",
  );

  const currentId = service.remoteServerId ?? null;

  useEffect(() => {
    setValue(currentId != null ? String(currentId) : "");
  }, [currentId]);
  const options = useMemo(() => q.data ?? [], [q.data]);

  const dirty =
    (value === "" && currentId !== null) ||
    (value !== "" && Number(value) !== currentId);

  const save = () => {
    const next =
      value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
    updateService.mutate(
      { id: service.id, patch: { remoteServerId: next } },
      {
        onSuccess: () => {
          toast({
            title: "Saved",
            description:
              next == null
                ? "Deploy commands will run on this Weehawk host."
                : "Deploy commands will use Docker over SSH on the selected host.",
          });
        },
        onError: (e: Error) =>
          toast({ title: "Could not save", description: e.message, variant: "destructive" }),
      },
    );
  };

  if (!accessToken) {
    return null;
  }

  return (
    <div className="glass-panel rounded-2xl overflow-hidden border border-white/5">
      <div className="px-5 py-3.5 border-b border-white/5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0 flex gap-3">
          <div className="rounded-lg bg-primary/10 border border-primary/20 p-2 h-fit">
            <Server className="size-4 text-primary shrink-0" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Remote Docker host</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-xl leading-relaxed">
              Optional: run <code className="text-foreground/80">docker compose</code>,{" "}
              <code className="text-foreground/80">stack deploy</code>, and related commands on another machine over SSH (
              <code className="text-foreground/80">DOCKER_HOST=ssh://…</code>). Compose files stay on this server; Docker syncs
              context over SSH. Configure hosts under{" "}
              <Link href="/remote-server" className="text-primary hover:underline">
                Remote servers
              </Link>
              .
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={!dirty || updateService.isPending}
            onClick={() => save()}
            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 disabled:opacity-40 disabled:pointer-events-none"
          >
            {updateService.isPending ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
          </button>
        </div>
      </div>
      <div className="px-5 py-4">
        {q.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading remote hosts…
          </div>
        ) : q.isError ? (
          <p className="text-sm text-red-300">{(q.error as Error).message}</p>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 max-w-xl">
            <label className="text-xs text-muted-foreground shrink-0 sm:w-32">Target host</label>
            <select
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="flex-1 min-w-0 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-foreground outline-none focus:border-primary/40"
            >
              <option value="">This server (local Docker)</option>
              {options.map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {r.name} — {r.sshUser}@{r.host}
                  {r.port !== 22 ? `:${r.port}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        {options.length === 0 && !q.isLoading && !q.isError && (
          <p className="text-xs text-muted-foreground mt-3">
            No remote hosts yet. Add one in{" "}
            <Link href="/remote-server" className="text-primary hover:underline">
              Remote servers
            </Link>{" "}
            (paste or generate a key; stored encrypted in the database).
          </p>
        )}
      </div>
    </div>
  );
}
