import { headers } from "next/headers";
import type { UserProfile } from "@/lib/user-api";
import { getServerApiBase } from "@/lib/server-api";

/** Used by RootLayout only — minimal imports to avoid pulling the full `server-fetch` graph into the layout bundle. */
export async function fetchUserProfileSSR(): Promise<UserProfile | null> {
  const h = await headers();
  const cookie = h.get("cookie");
  const res = await fetch(`${getServerApiBase()}/api/user/profile`, {
    headers: {
      Accept: "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json() as Promise<UserProfile>;
}
