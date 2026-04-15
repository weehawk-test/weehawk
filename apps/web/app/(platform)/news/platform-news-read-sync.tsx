"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import type { PlatformNewsItem } from "./platform-news";
import { markNewsFeedSeen } from "@/lib/platform-news-read";

/**
 * When the user visits `/news` or an article, mark the current feed head as seen so the sidebar badge clears.
 */
export function PlatformNewsReadSync({ initialFeed }: { initialFeed: PlatformNewsItem[] }) {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname.startsWith("/news")) return;
    if (initialFeed.length === 0) return;
    markNewsFeedSeen(initialFeed);
  }, [pathname, initialFeed]);

  return null;
}
