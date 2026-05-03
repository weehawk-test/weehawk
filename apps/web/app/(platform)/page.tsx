import { redirect } from "next/navigation";

/** Canonical project list lives at `/projects`; `/` keeps bookmarks working. */
export default async function HomeRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  if (sp.page) params.set("page", sp.page);
  if (sp.q) params.set("q", sp.q);
  const qs = params.toString();
  redirect(qs ? `/projects?${qs}` : "/projects");
}
