import Link from "next/link";
import { ChevronRight, Newspaper } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MOCK_PLATFORM_NEWS } from "./mock-news";
import {
  categoryBadgeClass,
  categoryLabel,
  formatNewsDate,
  newsCardClassName,
} from "./news-ui";
import { cn } from "@/lib/utils";

export default function NewsPage() {
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-primary">
            <Newspaper className="h-6 w-6" aria-hidden />
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Platform news</h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Product updates, maintenance notices, and highlights from the Weehawk team. Sample data for now.
          </p>
        </div>
      </div>

      <ul className="grid gap-4">
        {MOCK_PLATFORM_NEWS.map((item) => (
          <li key={item.id}>
            <Link href={`/news/${item.id}`} className={newsCardClassName("rounded-xl")}>
              <Card className="border-0 bg-transparent shadow-none">
                <CardHeader className="space-y-3 pb-4">
                  <div className="flex flex-wrap items-center gap-2 gap-y-1.5">
                    <Badge
                      variant="outline"
                      className={cn("font-medium", categoryBadgeClass[item.category])}
                    >
                      {categoryLabel[item.category]}
                    </Badge>
                    <time
                      dateTime={item.publishedAt}
                      className="text-xs text-muted-foreground tabular-nums"
                    >
                      {formatNewsDate(item.publishedAt)}
                    </time>
                  </div>
                  <CardTitle className="text-lg leading-snug pr-6">{item.title}</CardTitle>
                  <CardDescription className="text-sm leading-relaxed text-foreground/85">
                    {item.summary}
                  </CardDescription>
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-primary pt-1">
                    Read full article
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </span>
                </CardHeader>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
