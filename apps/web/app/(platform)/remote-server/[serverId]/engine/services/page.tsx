import { RemoteEngineUnifiedClient } from "../remote-engine-unified-client";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ serverId: string }>;
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const { serverId } = await params;
  const sp = await searchParams;
  const id = Number(serverId);
  if (!Number.isFinite(id)) return null;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const q = typeof sp.q === "string" ? sp.q : "";
  return (
    <RemoteEngineUnifiedClient serverId={id} resource="services" urlPage={page} urlQ={q} />
  );
}
