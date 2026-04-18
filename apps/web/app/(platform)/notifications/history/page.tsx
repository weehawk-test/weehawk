import { redirect } from "next/navigation";

/** History was removed; keep route for old links. */
export default function NotificationsHistoryRedirectPage() {
  redirect("/notifications");
}
