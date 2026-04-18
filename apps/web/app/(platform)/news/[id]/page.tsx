import Link from "next/link";
import { notFound } from "next/navigation";
import { Newspaper } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fetchPlatformNewsById } from "../platform-news";
import {
  categoryBadgeClass,
  categoryLabel,
  formatNewsDate,
  splitNewsContent,
} from "../news-ui";
import { cn } from "@/lib/utils";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function NewsDetailPage({ params }: Props) {
  const { id } = await params;
  const item = await fetchPlatformNewsById(id);
  if (!item) notFound();

  const paragraphs = splitNewsContent(item.content);

  return (
    <article className="space-y-8 max-w-3xl">
      <div>
        <nav className="mb-6 flex items-center gap-2.5 text-sm" aria-label="Breadcrumb">
          <Newspaper className="h-4 w-4 shrink-0 text-muted-foreground/80" strokeWidth={1.75} aria-hidden />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Link
              href="/news"
              scroll={false}
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground/90"
            >
              News
            </Link>
            <span className="select-none text-muted-foreground/45" aria-hidden>
              /
            </span>
            <span className="min-w-0 truncate font-semibold tracking-tight text-foreground">{item.title}</span>
          </div>
        </nav>

        <div className="flex flex-wrap items-center gap-2 gap-y-1.5 mb-4">
          <Badge
            variant="outline"
            className={cn("font-medium", categoryBadgeClass[item.category])}
          >
            {categoryLabel[item.category]}
          </Badge>
          <time
            dateTime={item.publishedAt}
            className="text-sm text-muted-foreground tabular-nums"
          >
            {formatNewsDate(item.publishedAt)}
          </time>
        </div>

        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground leading-tight">
          {item.title}
        </h1>
      </div>

      <div className="space-y-4 text-[15px] sm:text-base text-foreground/90">
        {paragraphs.map((p, i) => (
          <p key={i} className="leading-relaxed">
            {p}
          </p>
        ))}
      </div>
    </article>
  );
}
