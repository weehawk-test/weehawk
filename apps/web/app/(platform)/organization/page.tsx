import { redirect } from "next/navigation";
import { ORGANIZATION_MANAGEMENT_BASE } from "@/lib/org-nav-utils";

export default function OrganizationIndexPage() {
  redirect(`${ORGANIZATION_MANAGEMENT_BASE}/overview`);
}
