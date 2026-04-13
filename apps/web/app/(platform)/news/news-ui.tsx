import { cn } from "@/lib/utils";
import type { PlatformNewsCategory } from "./platform-news";

export const categoryLabel: Record<PlatformNewsCategory, string> = {
  product: "Product",
  security: "Security",
  maintenance: "Maintenance",
  community: "Community",
};

export const categoryBadgeClass: Record<PlatformNewsCategory, string> = {
  product: "border-primary/30 bg-primary/10 text-primary",
  security: "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  maintenance: "border-muted-foreground/25 bg-muted/80 text-muted-foreground",
  community: "border-secondary-foreground/20 bg-secondary text-secondary-foreground",
};

export function formatNewsDate(iso: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function splitNewsContent(content: string): string[] {
  return content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function newsCardClassName(extra?: string) {
  return cn(
    "block overflow-hidden border border-border/80 bg-card/65 backdrop-blur-sm transition-colors",
    "dark:bg-zinc-950/95 dark:border-zinc-800/90 dark:shadow-md dark:shadow-black/25 dark:backdrop-blur-none",
    "hover:bg-card/85 hover:border-primary/25 dark:hover:bg-zinc-900/95 dark:hover:border-primary/35",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    extra,
  );
}
