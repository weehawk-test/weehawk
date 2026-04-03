import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { S3BucketBrowser } from "@/components/s3/S3BucketBrowser";
import {
  fetchS3BucketObjectsSSR,
  fetchS3PrefixSummarySSR,
} from "@/lib/server-fetch";
import type { S3PrefixSummaryResponse } from "@/lib/s3-api";
import { normalizeS3PrefixParam } from "@/lib/s3-prefix-param";

export default async function S3BucketPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string; prefix?: string }>;
}) {
  const sp = await searchParams;
  const name = typeof sp.name === "string" ? sp.name.trim() : "";
  if (!name) {
    return (
      <div className="glass-panel rounded-xl p-10 max-w-lg mx-auto text-center border border-border/60">
        <div className="flex justify-center mb-6">
          <Link
            href="/s3"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <FolderKanban className="w-3.5 h-3.5 shrink-0" /> S3 destinations
          </Link>
        </div>
        <p className="text-muted-foreground">
          No destination selected. Open the bucket browser from an S3 destination card.
        </p>
      </div>
    );
  }

  const prefixParam = normalizeS3PrefixParam(sp.prefix);
  const initialList = await fetchS3BucketObjectsSSR(name, prefixParam);
  const initialFolderSummaries: Record<string, S3PrefixSummaryResponse> = {};
  if (initialList?.folders?.length) {
    const results = await Promise.all(
      initialList.folders.map(async (f) => {
        const s = await fetchS3PrefixSummarySSR(name, f.prefix);
        return [f.prefix, s] as const;
      }),
    );
    for (const [pfx, s] of results) {
      if (s) initialFolderSummaries[pfx] = s;
    }
  }

  return (
    <S3BucketBrowser
      key={`${name}:${prefixParam}`}
      profileName={name}
      initialPrefix={prefixParam}
      initialList={initialList}
      initialFolderSummaries={initialFolderSummaries}
    />
  );
}
