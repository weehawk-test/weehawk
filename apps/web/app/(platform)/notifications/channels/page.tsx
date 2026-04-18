import { redirect } from "next/navigation";

/** Prefer `/notifications`; keep this route for old links. */
export default function NotificationsChannelsRedirectPage() {
  redirect("/notifications");
}
