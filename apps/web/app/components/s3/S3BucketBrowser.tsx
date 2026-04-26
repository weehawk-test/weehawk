"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  Download,
  Folder,
  FolderKanban,
  FolderPlus,
  HardDrive,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { DockerBulkCheckbox } from "@/components/docker/DockerBulkCheckbox";
import {
  listS3BucketObjectsApi,
  deleteS3ObjectApi,
  deleteS3ObjectsBatchApi,
  deleteS3PrefixApi,
  getPrefixSummaryApi,
  uploadS3ObjectApi,
  downloadS3ObjectBlob,
  createS3FolderApi,
  type S3BucketListResponse,
  type S3PrefixSummaryResponse,
} from "@/lib/s3-api";
import { s3PrefixToPathSegments } from "@/lib/s3-prefix-param";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const BATCH_MAX = 1000;

function s3BucketBrowseHref(profileName: string, prefix: string): string {
  const profileSegment = encodeURIComponent(profileName.trim());
  const segments = s3PrefixToPathSegments(prefix).map((part) => encodeURIComponent(part));
  return `/s3/${profileSegment}${segments.length > 0 ? `/${segments.join("/")}` : ""}`;
}

function formatBytes(n: number): string {
  if (n === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(n) / Math.log(k)));
  return `${parseFloat((n / Math.pow(k, i)).toFixed(i > 0 ? 2 : 0))} ${sizes[i]}`;
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

/** Single path segment under the current prefix (no slashes, no `..`). */
function sanitizeNewFolderName(raw: string): string | null {
  const t = raw.trim();
  if (!t || t.includes("..") || t.includes("/") || t.includes("\\")) return null;
  if (t.length > 255) return null;
  return t;
}

/** Aggregate size / count / latest modified for everything under this prefix (recursive). */
function FolderStatsCells({
  profileName,
  folderPrefix,
  initialSummary,
}: {
  profileName: string;
  folderPrefix: string;
  /** From SSR — avoids a client fetch for this row on first paint. */
  initialSummary?: S3PrefixSummaryResponse | null;
}) {
  const [state, setState] = useState<
    "loading" | "error" | { data: S3PrefixSummaryResponse }
  >(() => (initialSummary ? { data: initialSummary } : "loading"));

  useEffect(() => {
    if (initialSummary) {
      setState({ data: initialSummary });
      return;
    }
    let cancelled = false;
    setState("loading");
    getPrefixSummaryApi(profileName, folderPrefix)
      .then((data) => {
        if (!cancelled) setState({ data });
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [profileName, folderPrefix, initialSummary]);

  if (state === "loading") {
    return (
      <>
        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap align-middle">
          <Loader2 className="w-4 h-4 animate-spin inline" />
        </td>
        <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell align-middle">…</td>
      </>
    );
  }
  if (state === "error") {
    return (
      <>
        <td className="px-4 py-3 text-muted-foreground align-middle">—</td>
        <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell align-middle">—</td>
      </>
    );
  }
  const { data } = state;
  const mod = data.lastModified ? new Date(data.lastModified).toLocaleString() : "—";
  return (
    <>
      <td className="px-4 py-3 text-muted-foreground align-middle">
        <div className="whitespace-nowrap leading-tight">
          {formatBytes(data.totalSize)}
          {data.isPartialSummary ? <span className="text-amber-500/90 ml-0.5">+</span> : null}
        </div>
        <div className="text-[11px] text-muted-foreground/90 mt-0.5 leading-tight">
          {data.objectCount.toLocaleString()} object{data.objectCount === 1 ? "" : "s"}
          {data.isPartialSummary ? " (≥)" : ""}
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground text-xs hidden sm:table-cell whitespace-nowrap align-middle">
        {mod}
      </td>
    </>
  );
}

export function S3BucketBrowser({
  profileName,
  initialPrefix = "",
  initialList = null,
  initialFolderSummaries,
}: {
  profileName: string;
  /** Current path from URL — folder navigation uses server render (no client list fetch). */
  initialPrefix: string;
  /** From SSR for this prefix — list + folder summaries fetched on the server. */
  initialList?: S3BucketListResponse | null;
  initialFolderSummaries?: Record<string, S3PrefixSummaryResponse>;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [prefix, setPrefix] = useState<string>(initialPrefix);
  const [bucket, setBucket] = useState<string>(() => initialList?.bucket ?? "");
  const [folders, setFolders] = useState<S3BucketListResponse["folders"]>(() => initialList?.folders ?? []);
  const [objects, setObjects] = useState<S3BucketListResponse["objects"]>(() => initialList?.objects ?? []);
  const [nextToken, setNextToken] = useState<string | undefined>(() =>
    initialList?.isTruncated ? initialList.continuationToken : undefined,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [deletingFolderPrefix, setDeletingFolderPrefix] = useState<string | null>(null);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState("");
  const [mkdirSaving, setMkdirSaving] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [selectedFolderPrefixes, setSelectedFolderPrefixes] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    setPrefix(initialPrefix);
  }, [initialPrefix]);

  useEffect(() => {
    setSelectedKeys(new Set());
    setSelectedFolderPrefixes(new Set());
  }, [prefix]);

  useEffect(() => {
    if (!initialList || prefix !== initialPrefix) return;
    setBucket(initialList.bucket);
    setFolders(initialList.folders);
    setObjects(initialList.objects);
    setNextToken(initialList.isTruncated ? initialList.continuationToken : undefined);
  }, [initialList, initialPrefix, prefix]);

  const loadPrefix = async (targetPrefix: string) => {
    setRefreshing(true);
    try {
      const r = await listS3BucketObjectsApi(profileName, { prefix: targetPrefix });
      setPrefix(targetPrefix);
      setBucket(r.bucket);
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

  const objectKeys = useMemo(() => objects.map((o) => o.key), [objects]);
  const allSelected =
    objectKeys.length > 0 && objectKeys.every((k) => selectedKeys.has(k));
  const someSelected = objectKeys.some((k) => selectedKeys.has(k));
  const headerCheckbox: boolean | "indeterminate" = allSelected
    ? true
    : someSelected
      ? "indeterminate"
      : false;

  const toggleSelectAllFiles = () => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (objectKeys.length > 0 && objectKeys.every((k) => next.has(k))) {
        objectKeys.forEach((k) => next.delete(k));
      } else {
        objectKeys.forEach((k) => next.add(k));
      }
      return next;
    });
  };

  const toggleFolderPrefix = (folderPrefix: string) => {
    setSelectedFolderPrefixes((prev) => {
      const next = new Set(prev);
      if (next.has(folderPrefix)) next.delete(folderPrefix);
      else next.add(folderPrefix);
      return next;
    });
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const k of next) {
        if (k.startsWith(folderPrefix)) next.delete(k);
      }
      return next;
    });
  };

  const toggleOneFile = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setSelectedFolderPrefixes((prev) => {
      const next = new Set(prev);
      for (const p of next) {
        if (key.startsWith(p)) next.delete(p);
      }
      return next;
    });
  };

  const onUpload = async (file: File) => {
    const key = `${prefix}${file.name}`;
    setUploading(true);
    try {
      await uploadS3ObjectApi(profileName, key, file);
      toast({ title: "Uploaded", description: key });
      await loadPrefix(prefix);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Upload failed", description: msg, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const onDownload = async (key: string, filename: string) => {
    setDownloadingKey(key);
    try {
      const blob = await downloadS3ObjectBlob(profileName, key);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Download failed", description: msg, variant: "destructive" });
    } finally {
      setDownloadingKey(null);
    }
  };

  const onCreateDirectory = async () => {
    const seg = sanitizeNewFolderName(mkdirName);
    if (!seg) {
      toast({
        title: "Invalid name",
        description: "Use a non-empty name without /, \\, or … segments.",
        variant: "destructive",
      });
      return;
    }
    const fullKey = prefix ? `${prefix}${seg}` : seg;
    setMkdirSaving(true);
    try {
      await createS3FolderApi(profileName, fullKey);
      toast({ title: "Directory created", description: fullKey.endsWith("/") ? fullKey : `${fullKey}/` });
      setMkdirOpen(false);
      setMkdirName("");
      await loadPrefix(prefix);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Could not create directory", description: msg, variant: "destructive" });
    } finally {
      setMkdirSaving(false);
    }
  };

  const onDeleteFile = async (key: string, label: string) => {
    const ok = await confirm({
      title: "Delete object?",
      description: `Permanently delete “${label}” from the bucket?`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingKey(key);
    try {
      await deleteS3ObjectApi(profileName, key);
      toast({ title: "Deleted", description: label });
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      await loadPrefix(prefix);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Delete failed", description: msg, variant: "destructive" });
    } finally {
      setDeletingKey(null);
    }
  };

  const onDeleteFolder = async (folderPrefix: string, label: string) => {
    const ok = await confirm({
      title: "Delete folder?",
      description: `Delete ALL objects under “${label}/” (recursive)? This cannot be undone.`,
      confirmLabel: "Delete folder",
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingFolderPrefix(folderPrefix);
    try {
      const r = await deleteS3PrefixApi(profileName, folderPrefix);
      const errN = r.errors.length;
      if (errN > 0) {
        toast({
          title: "Folder delete completed with errors",
          description: `Removed ${r.deletedCount} object(s). ${errN} error(s).`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Folder deleted",
          description: `Removed ${r.deletedCount} object(s) under this prefix.`,
        });
      }
      setSelectedFolderPrefixes((prev) => {
        const next = new Set(prev);
        next.delete(folderPrefix);
        return next;
      });
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        for (const k of next) {
          if (k.startsWith(folderPrefix)) next.delete(k);
        }
        return next;
      });
      await loadPrefix(prefix);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Delete folder failed", description: msg, variant: "destructive" });
    } finally {
      setDeletingFolderPrefix(null);
    }
  };

  const onBatchDelete = async () => {
    const prefixes = Array.from(selectedFolderPrefixes);
    let fileKeys = Array.from(selectedKeys);
    for (const p of prefixes) {
      fileKeys = fileKeys.filter((k) => !k.startsWith(p));
    }
    if (prefixes.length === 0 && fileKeys.length === 0) return;

    const ok = await confirm({
      title: "Delete selection?",
      description: [
        prefixes.length > 0 ? `${prefixes.length} folder(s) (recursive)` : null,
        fileKeys.length > 0 ? `${fileKeys.length} file(s)` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    setBatchDeleting(true);
    try {
      let prefixErrors = 0;
      for (const fp of prefixes) {
        const r = await deleteS3PrefixApi(profileName, fp);
        if (r.errors.length > 0) prefixErrors += r.errors.length;
      }
      let fileErrors = 0;
      for (let i = 0; i < fileKeys.length; i += BATCH_MAX) {
        const chunk = fileKeys.slice(i, i + BATCH_MAX);
        const r = await deleteS3ObjectsBatchApi(profileName, chunk);
        fileErrors += r.errors.length;
      }
      if (prefixErrors > 0 || fileErrors > 0) {
        toast({
          title: "Some deletes failed",
          description: `Folder errors: ${prefixErrors}, file batch errors: ${fileErrors}.`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Deleted", description: "Selection removed from the bucket." });
      }
      setSelectedKeys(new Set());
      setSelectedFolderPrefixes(new Set());
      await loadPrefix(prefix);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Batch delete failed", description: msg, variant: "destructive" });
    } finally {
      setBatchDeleting(false);
    }
  };

  const selectedCount = selectedKeys.size + selectedFolderPrefixes.size;

  if (!initialList) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2 min-w-0">
              <Link href="/s3">
                <span className="hover:text-foreground cursor-pointer flex items-center gap-1 transition-colors shrink-0">
                  <FolderKanban className="w-3.5 h-3.5" /> S3 destinations
                </span>
              </Link>
              <span className="text-white/20 shrink-0">/</span>
              <span className="text-foreground font-medium truncate min-w-0" title={profileName}>
                {profileName}
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <HardDrive className="w-7 h-7 text-primary shrink-0" />
              <span className="truncate">{profileName}</span>
            </h1>
          </div>
        </div>
        <div className="glass-panel rounded-xl border border-border/60 p-10 text-center">
          <p className="text-muted-foreground mb-4">Could not load this bucket path. Check the destination and try again.</p>
          <button
            type="button"
            className="btn-secondary text-sm inline-flex items-center gap-2"
            onClick={() => void onRefresh()}
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2 min-w-0">
            <Link href="/s3">
              <span className="hover:text-foreground cursor-pointer flex items-center gap-1 transition-colors shrink-0">
                <FolderKanban className="w-3.5 h-3.5" /> S3 destinations
              </span>
            </Link>
            <span className="text-white/20 shrink-0">/</span>
            <span className="text-foreground font-medium truncate min-w-0" title={profileName}>
              {profileName}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <HardDrive className="w-7 h-7 text-primary shrink-0" />
            <span className="truncate">{profileName}</span>
          </h1>
          {bucket ? (
            <p className="text-sm text-muted-foreground mt-1 font-mono truncate" title={bucket}>
              s3://{bucket}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="btn-secondary text-sm inline-flex items-center gap-2 cursor-pointer transition-none disabled:opacity-50">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? "Uploading…" : "Upload file"}
            <input
              type="file"
              className="sr-only"
              disabled={uploading || batchDeleting}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void onUpload(f);
              }}
            />
          </label>
          <button
            type="button"
            className="btn-secondary text-sm inline-flex items-center gap-2 transition-none active:!scale-100"
            onClick={() => {
              setMkdirName("");
              setMkdirOpen(true);
            }}
            disabled={uploading || batchDeleting || mkdirSaving}
          >
            <FolderPlus className="w-4 h-4" />
            Add directory
          </button>
          <button
            type="button"
            className="btn-secondary text-sm inline-flex items-center gap-2 transition-none active:!scale-100"
            onClick={() => void onRefresh()}
            disabled={refreshing || batchDeleting}
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      <Dialog
        open={mkdirOpen}
        onOpenChange={(open) => {
          setMkdirOpen(open);
          if (!open) setMkdirName("");
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add directory</DialogTitle>
            <DialogDescription>
              Creates a folder under the current path ({prefix ? prefix : "root"}). Name must not contain slashes.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="e.g. backups"
            value={mkdirName}
            onChange={(e) => setMkdirName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void onCreateDirectory();
            }}
            disabled={mkdirSaving}
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={mkdirSaving}
              onClick={() => setMkdirOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary text-sm inline-flex items-center gap-2"
              disabled={mkdirSaving}
              onClick={() => void onCreateDirectory()}
            >
              {mkdirSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Create
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="glass-panel rounded-xl border border-border/60 p-4 mb-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-2">Path</p>
        <div className="flex flex-wrap items-center gap-1 text-sm">
          {crumbs.map((c, i) => (
            <span key={`${c.prefix}-${i}`} className="flex items-center gap-1 min-w-0">
              {i > 0 ? <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" /> : null}
              <Link
                href={s3BucketBrowseHref(profileName, c.prefix)}
                onClick={(e) => {
                  e.preventDefault();
                  void loadPrefix(c.prefix);
                }}
                className={`truncate max-w-[200px] rounded px-1.5 py-0.5 transition-colors ${
                  c.prefix === prefix
                    ? "bg-primary/15 text-foreground font-medium"
                    : "text-primary hover:underline"
                }`}
                title={c.prefix || "Root"}
              >
                {c.label}
              </Link>
            </span>
          ))}
        </div>
      </div>

      {selectedCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 rounded-xl border border-border/60 bg-destructive/5 px-4 py-3">
          <span className="text-sm font-medium">
            {selectedFolderPrefixes.size > 0 ? (
              <span>
                {selectedFolderPrefixes.size} folder{selectedFolderPrefixes.size === 1 ? "" : "s"}
                {selectedKeys.size > 0 ? ", " : ""}
              </span>
            ) : null}
            {selectedKeys.size > 0 ? (
              <span>
                {selectedKeys.size} file{selectedKeys.size === 1 ? "" : "s"}
              </span>
            ) : null}
            <span className="text-muted-foreground font-normal"> · selected</span>
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={batchDeleting}
              onClick={() => {
                setSelectedKeys(new Set());
                setSelectedFolderPrefixes(new Set());
              }}
            >
              Clear selection
            </button>
            <button
              type="button"
              className="btn-secondary text-sm border-destructive/40 text-destructive hover:bg-destructive/10 inline-flex items-center gap-2"
              disabled={batchDeleting}
              onClick={() => void onBatchDelete()}
            >
              {batchDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Delete selected
            </button>
          </div>
        </div>
      ) : null}

      <div className="glass-panel rounded-xl border border-border/60 overflow-hidden">
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pl-3 pr-1 py-3 w-10">
                    {objectKeys.length > 0 ? (
                      <DockerBulkCheckbox
                        checked={headerCheckbox}
                        onCheckedChange={() => toggleSelectAllFiles()}
                        disabled={batchDeleting}
                        aria-label="Select all files in this list"
                      />
                    ) : null}
                  </th>
                  <th className="px-2 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium w-36">Size</th>
                  <th className="px-4 py-3 font-medium w-44 hidden sm:table-cell">Modified</th>
                  <th className="px-4 py-3 font-medium text-right min-w-[160px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {folders.map((f) => (
                  <tr key={f.prefix} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="pl-3 pr-1 py-3 align-middle w-10">
                      <DockerBulkCheckbox
                        checked={selectedFolderPrefixes.has(f.prefix)}
                        onCheckedChange={() => toggleFolderPrefix(f.prefix)}
                        disabled={batchDeleting}
                        aria-label={`Select folder ${f.name}`}
                      />
                    </td>
                    <td className="px-2 py-3 align-middle">
                      <Link
                        href={s3BucketBrowseHref(profileName, f.prefix)}
                        onClick={(e) => {
                          e.preventDefault();
                          void loadPrefix(f.prefix);
                        }}
                        className="inline-flex items-center gap-2 text-primary font-medium hover:underline text-left"
                      >
                        <Folder className="w-4 h-4 shrink-0 text-amber-500/90" />
                        <span className="font-mono truncate">{f.name}</span>
                      </Link>
                      <p className="text-[11px] text-muted-foreground mt-1 font-mono truncate sm:hidden">
                        Folder · open to browse
                      </p>
                    </td>
                    <FolderStatsCells
                      key={f.prefix}
                      profileName={profileName}
                      folderPrefix={f.prefix}
                      initialSummary={initialFolderSummaries?.[f.prefix]}
                    />
                    <td className="px-4 py-3 text-right align-middle whitespace-nowrap">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs sm:text-sm hover:bg-destructive/15 text-destructive"
                        title="Delete entire prefix"
                        disabled={deletingFolderPrefix === f.prefix || batchDeleting}
                        onClick={() => void onDeleteFolder(f.prefix, f.name)}
                      >
                        {deletingFolderPrefix === f.prefix ? (
                          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                        ) : (
                          <Trash2 className="w-4 h-4 shrink-0" />
                        )}
                        <span className="hidden sm:inline">Delete folder</span>
                      </button>
                    </td>
                  </tr>
                ))}
                {objects.map((o) => (
                  <tr key={o.key} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="pl-3 pr-1 py-3 align-middle w-10">
                      <DockerBulkCheckbox
                        checked={selectedKeys.has(o.key)}
                        onCheckedChange={() => toggleOneFile(o.key)}
                        disabled={batchDeleting}
                        aria-label={`Select ${o.name}`}
                      />
                    </td>
                    <td className="px-2 py-3 align-middle font-mono text-xs sm:text-sm break-all">{o.name}</td>
                    <td className="px-4 py-3 align-middle text-muted-foreground whitespace-nowrap">
                      {formatBytes(o.size)}
                    </td>
                    <td className="px-4 py-3 align-middle text-muted-foreground text-xs hidden sm:table-cell whitespace-nowrap">
                      {o.lastModified ? new Date(o.lastModified).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 align-middle text-right whitespace-nowrap">
                      <div className="inline-flex flex-wrap items-center justify-end gap-1 sm:gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs sm:text-sm hover:bg-primary/15 text-primary"
                          title="Download"
                          disabled={downloadingKey === o.key || batchDeleting}
                          onClick={() => void onDownload(o.key, o.name)}
                        >
                          {downloadingKey === o.key ? (
                            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                          ) : (
                            <Download className="w-4 h-4 shrink-0" />
                          )}
                          <span className="hidden sm:inline">Download</span>
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs sm:text-sm hover:bg-destructive/15 text-destructive"
                          title="Delete"
                          disabled={deletingKey === o.key || batchDeleting}
                          onClick={() => void onDeleteFile(o.key, o.name)}
                        >
                          {deletingKey === o.key ? (
                            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                          ) : (
                            <Trash2 className="w-4 h-4 shrink-0" />
                          )}
                          <span className="hidden sm:inline">Delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        </div>

        {folders.length === 0 && objects.length === 0 ? (
          <p className="p-8 text-center text-muted-foreground text-sm">This folder is empty.</p>
        ) : null}

        {nextToken ? (
          <div className="p-4 border-t border-border/60 flex justify-center">
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => void loadMore()}
              disabled={refreshing || batchDeleting}
            >
              {refreshing ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : null}
              Load more
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
