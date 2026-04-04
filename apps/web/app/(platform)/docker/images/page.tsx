import { redirectToLocalConsole } from "@/lib/redirect-local-console";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  redirectToLocalConsole("images", await searchParams);
}
