import Link from "next/link";
import { DockerSecretsClient } from "./secrets-client";

export const dynamic = "force-dynamic";
import { filterSshDeployServers } from "@/lib/loopback-ssh-host";
import { fetchRemoteServersSSR } from "@/lib/server-fetch";

export default async function Page({
  searchParams,
  organizationPublicId: orgPublicIdProp,
}: {
  searchParams: Promise<{ page?: string; q?: string; server?: string }>;
  organizationPublicId?: string;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const q = typeof sp.q === "string" ? sp.q : "";

  const orgPid = orgPublicIdProp?.trim();
  const secretsBase = "/secrets";
  const remoteServerHref = "/remote-server";

  const remoteServers = await fetchRemoteServersSSR(orgPid ?? undefined);
  const deployServers = filterSshDeployServers(remoteServers);
  const serverParam = typeof sp.server === "string" ? parseInt(sp.server, 10) : NaN;
  const explicitId = Number.isInteger(serverParam) && serverParam > 0 ? serverParam : null;
  const idInDeployList = explicitId != null && deployServers.some((s) => s.id === explicitId);
  const selectedId =
    explicitId != null && idInDeployList
      ? explicitId
      : explicitId != null && !idInDeployList
        ? null
        : deployServers[0]?.id ?? null;

  if (selectedId == null) {
    const invalidExplicit = explicitId != null && !idInDeployList;
    return (
      <div className="glass-panel rounded-xl border border-border p-6 space-y-3 max-w-xl">
        <h1 className="text-2xl font-bold">Docker Secrets</h1>
        {invalidExplicit ? (
          <p className="text-sm text-destructive">
            No SSH deploy server with id <span className="font-mono">{explicitId}</span>. Pick a host below or from{" "}
            <Link href={remoteServerHref} className="underline">
              Remote servers
            </Link>
            .
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Swarm secrets are managed over SSH on a deploy remote server. Add at least one SSH deploy host first, then
            return here or open secrets from the console for that server (
            <span className="font-mono text-xs">/docker-manager/[id]/secrets</span>).
          </p>
        )}
        {deployServers.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {deployServers.map((s) => (
              <Link
                key={s.id}
                href={`${secretsBase}?server=${s.id}`}
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-primary hover:underline"
              >
                #{s.id} {s.name?.trim() || s.host}
              </Link>
            ))}
          </div>
        )}
        {!invalidExplicit && (
          <Link href={remoteServerHref} className="text-primary hover:underline text-sm font-medium inline-block">
            Remote servers →
          </Link>
        )}
      </div>
    );
  }

  return (
    <>
      {deployServers.length > 1 && (
        <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Deploy host:</span>
          {deployServers.map((s) => (
            <Link
              key={s.id}
              href={`${secretsBase}?server=${s.id}${page !== 1 ? `&page=${page}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className={
                s.id === selectedId
                  ? "rounded-lg border border-primary bg-primary/10 px-3 py-1 font-medium text-primary"
                  : "rounded-lg border border-border px-3 py-1 text-muted-foreground hover:text-foreground hover:border-foreground/20"
              }
            >
              #{s.id} {s.name?.trim() || s.host}
            </Link>
          ))}
        </div>
      )}
      <DockerSecretsClient
        remoteServerId={selectedId}
        data={null}
        error={null}
        urlPage={page}
        urlQ={q}
        loadSecretsOnClient
      />
    </>
  );
}

