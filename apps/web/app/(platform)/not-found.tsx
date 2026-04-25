import { redirect } from "next/navigation";

export default function PlatformNotFound() {
  redirect("/resource-not-found");
}
