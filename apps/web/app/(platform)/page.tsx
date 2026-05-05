import { redirect } from "next/navigation";

/** Workspace root now lands on `/home`; `/` keeps bookmarks working. */
export default async function HomeRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    }
  }
  const qs = params.toString();
  redirect(qs ? `/home?${qs}` : "/home");
}
