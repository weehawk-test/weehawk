"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronRight,
  Folder,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  listS3BucketObjectsApi,
  listS3ProfilesApi,
  type S3ProfilePublic,
  type S3BucketListResponse,
} from "@/lib/s3-api";

function prefixSegments(prefix: string): string[] {
  const t = prefix.replace(/\/+$/, "");
  if (!t) return [];
  return t.split("/").filter(Boolean);
}

function joinPrefix(parts: string[]): string {
  if (parts.length === 0) return "";
  return `${parts.join("/")}/`;
}

export type S3ImportPickResult = { profileName: string; key: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Default profile when opening */
  defaultProfileName: string;
  /** If set, only keys ending with .tar.gz can be picked */
  requireTarGz?: boolean;
  title: string;
  description?: string;
  onPick: (result: S3ImportPickResult) => void;
};

export function S3ImportObjectPicker({
  open,
  onOpenChange,
  defaultProfileName,
  requireTarGz,
  title,
  description,
  onPick,
}: Props) {
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<S3ProfilePublic[]>([]);
  const [profileName, setProfileName] = useState(defaultProfileName);
  const [prefix, setPrefix] = useState("");
  const [folders, setFolders] = useState<S3BucketListResponse["folders"]>([]);
  const [objects, setObjects] = useState<S3BucketListResponse["objects"]>([]);
  const [nextToken, setNextToken] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listS3ProfilesApi()
      .then((list) => {
        if (!cancelled) setProfiles(list);
      })
      .catch((e) => {
        if (!cancelled) {
          toast({
            title: "Could not load S3 profiles",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, toast]);

  useEffect(() => {
    if (!open) return;
    setProfileName((prev) => {
      if (prev && profiles.some((p) => p.name === prev)) return prev;
      if (defaultProfileName && profiles.some((p) => p.name === defaultProfileName)) {
        return defaultProfileName;
      }
      return profiles[0]?.name ?? "";
    });
  }, [open, profiles, defaultProfileName]);

  const loadFirst = useCallback(async () => {
    if (!profileName.trim()) return;
    setLoading(true);
    setNextToken(undefined);
    try {
      const r = await listS3BucketObjectsApi(profileName, { prefix });
      setFolders(r.folders);
      setObjects(r.objects);
      setNextToken(r.isTruncated ? r.continuationToken : undefined);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFolders([]);
      setObjects([]);
      toast({ title: "List failed", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [profileName, prefix, toast]);

  useEffect(() => {
    if (!open || !profileName.trim()) return;
    void loadFirst();
  }, [open, profileName, prefix, loadFirst]);

  useEffect(() => {
    if (open) setPrefix("");
  }, [open, profileName]);

  const loadMore = async () => {
    if (!nextToken || !profileName.trim()) return;
    setLoading(true);
    try {
      const r = await listS3BucketObjectsApi(profileName, {
        prefix,
        continuationToken: nextToken,
      });
      setObjects((prev) => [...prev, ...r.objects]);
      setNextToken(r.isTruncated ? r.continuationToken : undefined);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Load more failed", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const crumbs = (() => {
    const segs = prefixSegments(prefix);
    const items: { label: string; prefix: string }[] = [{ label: "Root", prefix: "" }];
    for (let i = 0; i < segs.length; i++) {
      items.push({
        label: segs[i]!,
        prefix: joinPrefix(segs.slice(0, i + 1)),
      });
    }
    return items;
  })();

  const pickFile = (key: string) => {
    if (requireTarGz && !key.toLowerCase().endsWith(".tar.gz")) {
      toast({
        title: "Wrong file type",
        description: "Choose a .tar.gz archive for volume import.",
        variant: "destructive",
      });
      return;
    }
    onPick({ profileName, key });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[min(88vh,800px)] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : (
            <DialogDescription>
              Choose a saved destination, browse folders, then select one file.
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="px-6 pb-2 space-y-3 shrink-0">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">S3 destination</label>
            <select
              className="input-field w-full"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              disabled={loading}
            >
              {profiles.length === 0 ? (
                <option value="">No profiles</option>
              ) : (
                profiles.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} ({p.bucket})
                  </option>
                ))
              )}
            </select>
          </div>
          <div className="rounded-lg border border-border/50 bg-muted/15 px-3 py-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5">Path</p>
            <div className="flex flex-wrap items-center gap-1 text-sm">
              {crumbs.map((c, i) => (
                <span key={`${c.prefix}-${i}`} className="flex items-center gap-1 min-w-0">
                  {i > 0 ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : null}
                  <button
                    type="button"
                    onClick={() => setPrefix(c.prefix)}
                    className={`truncate max-w-[180px] rounded px-1 py-0.5 text-left ${
                      c.prefix === prefix ? "bg-primary/15 font-medium" : "text-primary hover:underline"
                    }`}
                  >
                    {c.label}
                  </button>
                </span>
              ))}
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              className="btn-secondary text-xs inline-flex items-center gap-1.5"
              onClick={() => void loadFirst()}
              disabled={loading || !profileName.trim()}
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Refresh
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto border-t border-border/60 px-6 py-3">
          {!profileName.trim() ? (
            <p className="text-sm text-muted-foreground">Add an S3 profile under S3 first.</p>
          ) : loading && folders.length === 0 && objects.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading…
            </div>
          ) : (
            <ul className="space-y-1">
              {folders.map((f) => (
                <li key={f.prefix}>
                  <button
                    type="button"
                    onClick={() => setPrefix(f.prefix)}
                    className="w-full text-left flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-muted/30"
                  >
                    <Folder className="w-4 h-4 text-amber-500/90 shrink-0" />
                    <span className="font-mono text-sm truncate">{f.name}</span>
                  </button>
                </li>
              ))}
              {objects.map((o) => {
                const blocked =
                  requireTarGz && !o.key.toLowerCase().endsWith(".tar.gz");
                return (
                  <li key={o.key}>
                    <button
                      type="button"
                      disabled={blocked}
                      onClick={() => pickFile(o.key)}
                      className={`w-full text-left rounded-lg px-3 py-2 font-mono text-xs sm:text-sm break-all ${
                        blocked
                          ? "opacity-40 cursor-not-allowed"
                          : "hover:bg-primary/10 text-foreground"
                      }`}
                    >
                      {o.name}
                      {blocked ? (
                        <span className="block text-[11px] text-muted-foreground mt-0.5">
                          Volume import requires .tar.gz
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {folders.length === 0 && objects.length === 0 && !loading && profileName.trim() ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Empty at this path.</p>
          ) : null}
          {nextToken ? (
            <div className="flex justify-center pt-4">
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => void loadMore()}
                disabled={loading}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : null}
                Load more
              </button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
