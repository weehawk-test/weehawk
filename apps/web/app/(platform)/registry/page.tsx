import { fetchRegistryAccountsSSR } from "@/lib/server-fetch";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";
import type { RegistryAccountRow } from "@/lib/registry-api";
import { RegistryClient } from "./registry-client";

export const dynamic = "force-dynamic";

export default async function RegistryPage() {
  const orgPid = await getServerActiveOrganizationPublicId();
  let initialAccounts: RegistryAccountRow[] = [];
  let initialError: string | null = null;
  try {
    initialAccounts = await fetchRegistryAccountsSSR(orgPid ?? undefined);
  } catch (e) {
    initialError = e instanceof Error ? e.message : String(e);
  }
  return <RegistryClient initialAccounts={initialAccounts} initialError={initialError} />;
}
