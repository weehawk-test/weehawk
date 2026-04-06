import type { UserProfile } from "@/lib/user-api";
import { getServerApiBase } from "@/lib/server-api";
import { buildServerApiCookieHeaders } from "@/lib/server-cookie-headers";

/** Used by RootLayout only — minimal imports to avoid pulling the full `server-fetch` graph into the layout bundle. */
export async function fetchUserProfileSSR(): Promise<UserProfile | null> {
  const res = await fetch(`${getServerApiBase()}/api/user/profile`, {
    headers: await buildServerApiCookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json() as Promise<UserProfile>;
}
