export type PlatformNewsCategory = "product" | "security" | "maintenance" | "community";

export type PlatformNewsItem = {
  id: string;
  title: string;
  summary: string;
  /** Full article body; paragraphs separated by blank lines. */
  content: string;
  publishedAt: string;
  category: PlatformNewsCategory;
};

/** Full URL; override with `NEXT_PUBLIC_PLATFORM_NEWS_URL` for staging/self-hosted. */
export const PLATFORM_NEWS_FETCH_URL = (
  process.env.NEXT_PUBLIC_PLATFORM_NEWS_URL?.trim() || "https://api.weehawk.io/news"
).replace(/\/+$/, "");

const CATEGORIES: PlatformNewsCategory[] = ["product", "security", "maintenance", "community"];

function normalizeCategory(raw: unknown): PlatformNewsCategory {
  const s = String(raw ?? "")
    .toLowerCase()
    .trim();
  if (CATEGORIES.includes(s as PlatformNewsCategory)) return s as PlatformNewsCategory;
  const first = s.split(/[\s/]+/)[0];
  if (CATEGORIES.includes(first as PlatformNewsCategory)) return first as PlatformNewsCategory;
  return "product";
}

function parseNewsItem(raw: unknown): PlatformNewsItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = o.id != null ? String(o.id) : "";
  const title = typeof o.title === "string" ? o.title : "";
  const summary = typeof o.summary === "string" ? o.summary : "";
  const content = typeof o.content === "string" ? o.content : "";
  const publishedAt = typeof o.publishedAt === "string" ? o.publishedAt : "";
  if (!id || !title) return null;
  return {
    id,
    title,
    summary: summary || title,
    content: content || summary || title,
    publishedAt: publishedAt || new Date().toISOString().slice(0, 10),
    category: normalizeCategory(o.category),
  };
}

/** Fetches the public news feed from {@link PLATFORM_NEWS_FETCH_URL}. */
export async function fetchPlatformNews(): Promise<PlatformNewsItem[]> {
  try {
    const res = await fetch(PLATFORM_NEWS_FETCH_URL, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .map(parseNewsItem)
      .filter((x): x is PlatformNewsItem => x != null)
      .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0));
  } catch {
    return [];
  }
}

export async function fetchPlatformNewsById(id: string): Promise<PlatformNewsItem | undefined> {
  const items = await fetchPlatformNews();
  return items.find((n) => n.id === id);
}
