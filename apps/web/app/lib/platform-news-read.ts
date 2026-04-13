import type { PlatformNewsItem } from "@/(platform)/news/platform-news";

export const PLATFORM_NEWS_SEEN_STORAGE_KEY = "weehawk-platform-news-seen";

/** Dispatched on `window` after the user opens News and the seen cursor is updated. */
export const PLATFORM_NEWS_SEEN_EVENT = "weehawk-platform-news-seen";

export type NewsSeenCursor = { publishedAt: string; id: string };

export function readNewsSeenCursor(): NewsSeenCursor | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PLATFORM_NEWS_SEEN_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return null;
    const rec = o as Record<string, unknown>;
    const publishedAt = typeof rec.publishedAt === "string" ? rec.publishedAt : "";
    const id = typeof rec.id === "string" ? rec.id : "";
    if (!publishedAt || !id) return null;
    return { publishedAt, id };
  } catch {
    return null;
  }
}

export function writeNewsSeenCursor(cursor: NewsSeenCursor): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PLATFORM_NEWS_SEEN_STORAGE_KEY, JSON.stringify(cursor));
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * `feed` must be sorted newest first (same order as `fetchPlatformNews`).
 * Shows unread when the user has never acknowledged the feed, or when the newest item is newer than the stored cursor.
 */
export function newsFeedHasUnread(feed: PlatformNewsItem[]): boolean {
  if (feed.length === 0) return false;
  const latest = feed[0];
  const seen = readNewsSeenCursor();
  if (!seen) return true;
  if (latest.publishedAt > seen.publishedAt) return true;
  if (latest.publishedAt < seen.publishedAt) return false;
  return latest.id !== seen.id;
}

export function markNewsFeedSeen(feed: PlatformNewsItem[]): void {
  if (feed.length === 0) return;
  writeNewsSeenCursor({ publishedAt: feed[0].publishedAt, id: feed[0].id });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PLATFORM_NEWS_SEEN_EVENT));
  }
}
