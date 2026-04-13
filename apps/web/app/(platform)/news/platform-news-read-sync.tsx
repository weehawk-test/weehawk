"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import type { PlatformNewsItem } from "./platform-news";
import { markNewsFeedSeen } from "@/lib/platform-news-read";

function parseFeed(data: unknown): PlatformNewsItem[] {
  if (!Array.isArray(data)) return [];
  return data as PlatformNewsItem[];
}

/**
 * When the user visits `/news` or an article, mark the current feed head as seen so the sidebar badge clears.
 */
export function PlatformNewsReadSync() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname.startsWith("/news")) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/platform-news", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data: unknown = await res.json();
        const feed = parseFeed(data);
        if (feed.length === 0 || cancelled) return;
        markNewsFeedSeen(feed);
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return null;
}
