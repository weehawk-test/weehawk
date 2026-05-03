import { redirect } from "next/navigation";

/** Legacy URL: creation flow lives in the modal route `/organizations/create` (same pattern as cron jobs). */
export default function LegacyOrganizationsNewRedirect() {
  redirect("/organizations/create");
}
