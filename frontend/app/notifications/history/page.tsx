import { headers } from "next/headers";
import { API_BASE } from "@/lib/api";
import { NotificationsHistoryClient } from "./notifications-history-client";
import type { PaginatedNotificationLogsResponse } from "@/lib/notifications-api";

const LOGS_PAGE_SIZE = 10;

async function getLogsPaged(page: number, q: string): Promise<PaginatedNotificationLogsResponse> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(LOGS_PAGE_SIZE),
  });
  const trimmed = q.trim();
  if (trimmed) params.set("q", trimmed);
  const cookieHeader = (await headers()).get("cookie") ?? "";
  const res = await fetch(`${API_BASE}/api/notifications/logs/paged?${params.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Cookie: cookieHeader,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Could not load notifications.");
  }
  return res.json();
}

export default async function NotificationsHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const urlPage = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const urlQ = typeof sp.q === "string" ? sp.q : "";
  let initialData: PaginatedNotificationLogsResponse | null = null;
  let initialError: string | null = null;
  try {
    initialData = await getLogsPaged(urlPage, urlQ);
  } catch (e) {
    initialError = e instanceof Error ? e.message : String(e);
  }
  return (
    <NotificationsHistoryClient
      initialData={initialData}
      initialError={initialError}
      urlPage={urlPage}
      urlQ={urlQ}
    />
  );
}

