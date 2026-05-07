"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
import { normalizeS3PrefixParam } from "@/lib/s3-prefix-param";
import {
  listS3BucketObjectsApi,
  listS3ProfilesApi,
  s3ProfileRouteId,
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

function buildServiceImportPickerUrl(
  pathname: string,
  currentSearch: URLSearchParams,
  mode: "db" | "vol",
  profileId: string,
  prefix: string,
): string {
  const q = new URLSearchParams(currentSearch.toString());
  q.set("s3Import", mode);
  q.set("s3Profile", profileId);
  if (prefix) q.set("s3Prefix", prefix);
  else q.delete("s3Prefix");
  return `${pathname}?${q.toString()}`;
}

export type S3ImportPickResult = { profileName: string; key: string };

export type S3ImportObjectPickerSsr = {
  profileId: string;
  profileName: string;
  prefix: string;
  initialList: S3BucketListResponse | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Default profile when opening (client mode) or fallback label */
  defaultProfileName: string;
  /** If set, only keys ending with .tar.gz can be picked */
  requireTarGz?: boolean;
  title: string;
  description?: string;
  onPick: (result: S3ImportPickResult) => void;
  /**
   * When set with service page URL (`?s3Import=db|vol&s3Profile=&s3Prefix=`), listing is
   * server-rendered and folder navigation updates the URL (no client list API for navigation).
   */
  importPickerMode?: "db" | "vol";
  /** Server-fetched bucket listing for the current URL; ignored when importPickerMode is unset */
  ssr?: S3ImportObjectPickerSsr | null;
  /** From SSR — avoids client GET /s3/profiles when opening the dialog */
  initialProfiles?: S3ProfilePublic[];
  /** Required for client-side profile list when `initialProfiles` is not provided. */
  activeOrgPublicId?: string | null;
};

export function S3ImportObjectPicker({
  open,
  onOpenChange,
  defaultProfileName,
  requireTarGz,
  title,
  description,
  onPick,
  importPickerMode,
  ssr,
  initialProfiles,
  activeOrgPublicId,
}: Props) {
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const orgTrim = activeOrgPublicId?.trim() ?? "";
  const s3QueryOrg = orgTrim.length > 0 ? orgTrim : null;

  const urlMode = importPickerMode !== undefined;

  const profilesQuery = useQuery({
    queryKey: ["s3-profiles", s3QueryOrg],
    queryFn: () => listS3ProfilesApi(),
    enabled: Boolean(open && s3QueryOrg),
    ...(initialProfiles !== undefined ? { initialData: initialProfiles } : {}),
  });
  const profiles = profilesQuery.data ?? [];
  const [profileName, setProfileName] = useState(defaultProfileName);
  const [internalPrefix, setInternalPrefix] = useState("");
  const [folders, setFolders] = useState<S3BucketListResponse["folders"]>([]);
  const [objects, setObjects] = useState<S3BucketListResponse["objects"]>([]);
  const [nextToken, setNextToken] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const prefix = urlMode
    ? normalizeS3PrefixParam(searchParams.get("s3Prefix"))
    : internalPrefix;

  const profileIdEffective = urlMode
    ? (searchParams.get("s3Profile") ?? "").trim()
    : (s3ProfileRouteId(profiles.find((p) => p.name === profileName) ?? { name: profileName }) ?? "").trim();

  const profileNameEffective = urlMode
    ? (ssr?.profileName ?? "")
    : profileName;

  useEffect(() => {
    if (!open || s3QueryOrg) return;
    toast({
      title: "Organization required",
      description: "Select an organization to list S3 profiles.",
      variant: "destructive",
    });
  }, [open, s3QueryOrg, toast]);

  useEffect(() => {
    if (!open || urlMode) return;
    setProfileName((prev) => {
      if (prev && profiles.some((p) => p.name === prev)) return prev;
      if (defaultProfileName && profiles.some((p) => p.name === defaultProfileName)) {
        return defaultProfileName;
      }
      return profiles[0]?.name ?? "";
    });
  }, [open, profiles, defaultProfileName, urlMode]);

  useEffect(() => {
    if (!urlMode) return;
    if (!ssr) return;
    if (!ssr.initialList) {
      setFolders([]);
      setObjects([]);
      setNextToken(undefined);
      return;
    }
    setFolders(ssr.initialList.folders);
    setObjects(ssr.initialList.objects);
    setNextToken(ssr.initialList.isTruncated ? ssr.initialList.continuationToken : undefined);
  }, [urlMode, ssr]);

  const loadFirst = useCallback(async () => {
    if (!profileName.trim()) return;
    if (!orgTrim) {
      toast({
        title: "Organization required",
        description: "Select an organization to browse S3 objects.",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    setNextToken(undefined);
    try {
      const selected = profiles.find((p) => p.name === profileName);
      if (!selected) return;
      const r = await listS3BucketObjectsApi(s3ProfileRouteId(selected), {
        prefix: internalPrefix,
      });
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
  }, [profileName, internalPrefix, profiles, toast, orgTrim]);

  useEffect(() => {
    if (urlMode || !open || !profileName.trim()) return;
    void loadFirst();
  }, [open, profileName, internalPrefix, loadFirst, urlMode]);

  useEffect(() => {
    if (urlMode || !open) return;
    setInternalPrefix("");
  }, [open, profileName, urlMode]);

  const onRefresh = async () => {
    if (urlMode) {
      setRefreshing(true);
      try {
        await router.refresh();
      } finally {
        setRefreshing(false);
      }
      return;
    }
    await loadFirst();
  };

  const loadMore = async () => {
    const profileId = profileIdEffective;
    if (!nextToken || !profileId) return;
    setLoading(true);
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
      setLoading(false);
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
    const pn = profileNameEffective;
    if (!pn) return;
    onPick({ profileName: pn, key });
    onOpenChange(false);
  };

  const listBusy = urlMode ? refreshing : loading;

  const showLegacySpinner =
    !urlMode && loading && folders.length === 0 && objects.length === 0 && profileName.trim();

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
              value={urlMode ? profileIdEffective : profileName}
              onChange={(e) => {
                const v = e.target.value;
                if (urlMode && importPickerMode) {
                  router.replace(
                    buildServiceImportPickerUrl(pathname, searchParams, importPickerMode, v, ""),
                    { scroll: false },
                  );
                } else {
                  const next = profiles.find((p) => s3ProfileRouteId(p) === v);
                  setProfileName(next?.name ?? "");
                }
              }}
              disabled={listBusy}
            >
              {profiles.length === 0 ? (
                <option value="">No profiles</option>
              ) : (
                profiles.map((p) => (
                  <option key={p.publicId ?? p.name} value={s3ProfileRouteId(p)}>
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
                  {urlMode && importPickerMode && profileIdEffective ? (
                    <Link
                      href={buildServiceImportPickerUrl(
                        pathname,
                        searchParams,
                        importPickerMode,
                        profileIdEffective,
                        c.prefix,
                      )}
                      scroll={false}
                      className={`truncate max-w-[180px] rounded px-1 py-0.5 text-left ${
                        c.prefix === prefix ? "bg-primary/15 font-medium" : "text-primary hover:underline"
                      }`}
                    >
                      {c.label}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setInternalPrefix(c.prefix)}
                      className={`truncate max-w-[180px] rounded px-1 py-0.5 text-left ${
                        c.prefix === internalPrefix ? "bg-primary/15 font-medium" : "text-primary hover:underline"
                      }`}
                    >
                      {c.label}
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              className="btn-secondary text-xs inline-flex items-center gap-1.5"
              onClick={() => void onRefresh()}
              disabled={listBusy || !(urlMode ? profileIdEffective : profileName.trim())}
            >
              {listBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Refresh
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto border-t border-border/60 px-6 py-3">
          {urlMode && ssr && ssr.initialList === null && profileIdEffective ? (
            <div className="space-y-3 py-6 text-center">
              <p className="text-sm text-muted-foreground">Could not load this path.</p>
              <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={() => void onRefresh()}>
                <RefreshCw className="w-3.5 h-3.5" />
                Retry
              </button>
            </div>
          ) : !(urlMode ? profileNameEffective : profileName.trim()) ? (
            <p className="text-sm text-muted-foreground">Add an S3 profile under S3 first.</p>
          ) : showLegacySpinner ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading…
            </div>
          ) : (
            <ul className="space-y-1">
              {folders.map((f) => (
                <li key={f.prefix}>
                  {urlMode && importPickerMode && profileIdEffective ? (
                    <Link
                      href={buildServiceImportPickerUrl(
                        pathname,
                        searchParams,
                        importPickerMode,
                        profileIdEffective,
                        f.prefix,
                      )}
                      scroll={false}
                      className="w-full text-left flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-muted/30"
                    >
                      <Folder className="w-4 h-4 text-amber-500/90 shrink-0" />
                      <span className="font-mono text-sm truncate">{f.name}</span>
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setInternalPrefix(f.prefix)}
                      className="w-full text-left flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-muted/30"
                    >
                      <Folder className="w-4 h-4 text-amber-500/90 shrink-0" />
                      <span className="font-mono text-sm truncate">{f.name}</span>
                    </button>
                  )}
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
          {folders.length === 0 && objects.length === 0 && !listBusy && (urlMode ? profileIdEffective : profileName.trim()) ? (
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
