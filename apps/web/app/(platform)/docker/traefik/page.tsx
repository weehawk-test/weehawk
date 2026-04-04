import { redirect } from "next/navigation";

/** @deprecated Use `/traefik` (main sidebar → More). */
export default function TraefikRedirectPage() {
  redirect("/traefik");
}
