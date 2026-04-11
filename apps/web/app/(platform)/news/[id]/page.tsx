import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getPlatformNewsById } from "../mock-news";
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
  const item = getPlatformNewsById(id);
  if (!item) notFound();

  const paragraphs = splitNewsContent(item.content);

  return (
    <article className="space-y-8 max-w-3xl">
      <div>
        <Link
          href="/news"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to news
        </Link>

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
