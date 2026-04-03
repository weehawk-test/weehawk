"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { S3BucketBrowser } from "@/components/s3/S3BucketBrowser";

function BucketPageInner() {
  const sp = useSearchParams();
  const name = sp.get("name")?.trim() ?? "";
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
  return <S3BucketBrowser profileName={name} />;
}

export default function S3BucketPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground flex items-center gap-2">Loading…</div>}>
      <BucketPageInner />
    </Suspense>
  );
}
