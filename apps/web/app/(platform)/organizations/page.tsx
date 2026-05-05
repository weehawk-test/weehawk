import { redirect } from "next/navigation";
import { fetchOrganizationsListSSR } from "@/lib/server-fetch";
import { pickDefaultWorkspaceOrganization } from "@/lib/pick-primary-owned-org";

/** Legacy index: send users into their default org workspace (or create flow). */
export default async function OrganizationsIndexRedirect() {
  const orgs = await fetchOrganizationsListSSR();
  const d = pickDefaultWorkspaceOrganization(orgs);
  if (d?.publicId) {
    redirect("/home");
  }
  redirect("/organizations/create");
}
