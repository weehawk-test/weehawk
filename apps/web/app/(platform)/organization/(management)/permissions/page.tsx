import { redirect } from "next/navigation";

export default function OrganizationPermissionPage() {
  redirect("/organization/members");
}
