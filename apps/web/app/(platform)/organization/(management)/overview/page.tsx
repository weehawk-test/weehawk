import { redirect } from "next/navigation";

export default function OrganizationOverviewPage() {
  redirect("/organization/members");
}
