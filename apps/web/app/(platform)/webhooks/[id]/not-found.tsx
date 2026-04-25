import { redirect } from "next/navigation";

export default function WebhookNotFound() {
  redirect("/resource-not-found");
}
