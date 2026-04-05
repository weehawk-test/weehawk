import { redirect } from "next/navigation";

/** List lives at `/`; keep `/projects` as a permanent alias (bookmarks & old links). */
export default async function ProjectsAliasPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  if (sp.page) params.set("page", sp.page);
  if (sp.q) params.set("q", sp.q);
  const qs = params.toString();
  redirect(qs ? `/?${qs}` : "/");
}
