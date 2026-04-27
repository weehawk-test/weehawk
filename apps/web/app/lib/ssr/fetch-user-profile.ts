import type { UserProfile } from "@/lib/user-api";
import { getServerApiBase } from "@/lib/server-api";
import { buildServerApiCookieHeaders } from "@/lib/server-cookie-headers";

/** Used by RootLayout only — minimal imports to avoid pulling the full `server-fetch` graph into the layout bundle. */
export async function fetchUserProfileSSR(): Promise<UserProfile | null> {
  const headers = new Headers(await buildServerApiCookieHeaders());
  const apiKey = (process.env.WEEHAWK_API_KEY ?? "").trim();
  if (apiKey) headers.set("X-Weehawk-Api-Key", apiKey);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const res = await fetch(`${getServerApiBase()}/api/user/profile`, {
    headers,
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json() as Promise<UserProfile>;
}
