"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Folder, Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { listS3BucketObjectsApi, type S3BucketListResponse } from "@/lib/s3-api";

export const S3_IMPORT_PICK_MESSAGE_TYPE = "weehawk:s3-import-pick" as const;

export function s3ImportPickerHref(
  profileId: string,
  prefix: string,
  requireTarGz: boolean,
): string {
  const q = new URLSearchParams({ profileId });
  if (prefix) q.set("prefix", prefix);
  if (requireTarGz) q.set("requireTarGz", "1");
  return `/s3/import-picker?${q.toString()}`;
}

function prefixSegments(prefix: string): string[] {
  const t = prefix.replace(/\/+$/, "");
  if (!t) return [];
  return t.split("/").filter(Boolean);
}

function joinPrefix(parts: string[]): string {
  if (parts.length === 0) return "";
  return `${parts.join("/")}/`;
}

export function S3ImportPickerClient({
  profileId,
  initialPrefix,
  initialList,
  requireTarGz,
}: {
  profileId: string;
  initialPrefix: string;
  initialList: S3BucketListResponse | null;
  requireTarGz: boolean;
}) {
  const { toast } = useToast();
  const [prefix, setPrefix] = useState(initialPrefix);
  const [folders, setFolders] = useState<S3BucketListResponse["folders"]>(() => initialList?.folders ?? []);
  const [objects, setObjects] = useState<S3BucketListResponse["objects"]>(() => initialList?.objects ?? []);
  const [nextToken, setNextToken] = useState<string | undefined>(() =>
    initialList?.isTruncated ? initialList.continuationToken : undefined,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [embedded, setEmbedded] = useState(false);

  useEffect(() => {
    setEmbedded(typeof window !== "undefined" && window.parent !== window);
  }, []);

  useEffect(() => {
    setPrefix(initialPrefix);
  }, [initialPrefix]);

  useEffect(() => {
    if (!initialList) return;
    setFolders(initialList.folders);
    setObjects(initialList.objects);
    setNextToken(initialList.isTruncated ? initialList.continuationToken : undefined);
  }, [initialList]);

  const loadPrefix = async (targetPrefix: string) => {
    setRefreshing(true);
    try {
      const r = await listS3BucketObjectsApi(profileId, {
        prefix: targetPrefix,
      });
      setPrefix(targetPrefix);
      setFolders(r.folders);
      setObjects(r.objects);
      setNextToken(r.isTruncated ? r.continuationToken : undefined);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Load failed", description: msg, variant: "destructive" });
    } finally {
      setRefreshing(false);
    }
  };

  const onRefresh = async () => {
    await loadPrefix(prefix);
  };

  const loadMore = async () => {
    if (!nextToken) return;
    setRefreshing(true);
    try {
      const r = await listS3BucketObjectsApi(profileId, {
        prefix,
        continuationToken: nextToken,
      });
      setObjects((prev) => [...prev, ...r.objects]);
      setNextToken(r.isTruncated ? r.continuationToken : undefined);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Load more failed", description: msg, variant: "destructive" });
    } finally {
      setRefreshing(false);
    }
  };

  const crumbs = useMemo(() => {
    const segs = prefixSegments(prefix);
    const items: { label: string; prefix: string }[] = [{ label: "Root", prefix: "" }];
    for (let i = 0; i < segs.length; i++) {
      items.push({
        label: segs[i]!,
        prefix: joinPrefix(segs.slice(0, i + 1)),
      });
    }
    return items;
  }, [prefix]);

  const pickFile = (key: string) => {
    if (requireTarGz && !key.toLowerCase().endsWith(".tar.gz")) {
      toast({
        title: "Wrong file type",
        description: "Choose a .tar.gz archive for volume import.",
        variant: "destructive",
      });
      return;
    }
    if (embedded) {
      window.parent.postMessage(
        { type: S3_IMPORT_PICK_MESSAGE_TYPE, profileId, key },
        window.location.origin,
      );
      return;
    }
    void navigator.clipboard.writeText(key).catch(() => {});
    toast({ title: "Object key", description: key });
  };

  if (!initialList) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        <p className="mb-3">Could not load this path.</p>
        <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={() => void onRefresh()}>
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0">
      <div className="rounded-lg border border-border/50 bg-muted/15 px-3 py-2 mb-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5">Path</p>
        <div className="flex flex-wrap items-center gap-1 text-sm">
          {crumbs.map((c, i) => (
            <span key={`${c.prefix}-${i}`} className="flex items-center gap-1 min-w-0">
              {i > 0 ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : null}
              <Link
                href={s3ImportPickerHref(profileId, c.prefix, requireTarGz)}
                onClick={(e) => {
                  e.preventDefault();
                  void loadPrefix(c.prefix);
                }}
                className={`truncate max-w-[180px] rounded px-1 py-0.5 ${
                  c.prefix === prefix ? "bg-primary/15 font-medium" : "text-primary hover:underline"
                }`}
              >
                {c.label}
              </Link>
            </span>
          ))}
        </div>
      </div>
      <div className="flex justify-end mb-2">
        <button
          type="button"
          className="btn-secondary text-xs inline-flex items-center gap-1.5"
          onClick={() => void onRefresh()}
          disabled={refreshing}
        >
          {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <ul className="space-y-1">
          {folders.map((f) => (
            <li key={f.prefix}>
              <Link
                href={s3ImportPickerHref(profileId, f.prefix, requireTarGz)}
                onClick={(e) => {
                  e.preventDefault();
                  void loadPrefix(f.prefix);
                }}
                className="w-full text-left flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-muted/30"
              >
                <Folder className="w-4 h-4 text-amber-500/90 shrink-0" />
                <span className="font-mono text-sm truncate">{f.name}</span>
              </Link>
            </li>
          ))}
          {objects.map((o) => {
            const blocked = requireTarGz && !o.key.toLowerCase().endsWith(".tar.gz");
            return (
              <li key={o.key}>
                <button
                  type="button"
                  disabled={blocked}
                  onClick={() => pickFile(o.key)}
                  className={`w-full text-left rounded-lg px-3 py-2 font-mono text-xs sm:text-sm break-all ${
                    blocked ? "opacity-40 cursor-not-allowed" : "hover:bg-primary/10 text-foreground"
                  }`}
                >
                  {o.name}
                  {blocked ? (
                    <span className="block text-[11px] text-muted-foreground mt-0.5">Volume import requires .tar.gz</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        {folders.length === 0 && objects.length === 0 && !refreshing ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Empty at this path.</p>
        ) : null}
        {nextToken ? (
          <div className="flex justify-center pt-4">
            <button type="button" className="btn-secondary text-sm" onClick={() => void loadMore()} disabled={refreshing}>
              {refreshing ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : null}
              Load more
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
