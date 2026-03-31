"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import {
  HardDrive, Plus, Search, Trash2, FolderOpen, Upload, Download,
  File, ChevronRight, ArrowLeft, RefreshCw, Lock, Globe, Copy,
  Settings, Layers,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Bucket {
  id: string;
  name: string;
  region: string;
  access: "private" | "public";
  createdAt: string;
  objectCount: number;
  size: string;
}

interface S3Object {
  id: string;
  bucketId: string;
  key: string;
  size: string;
  contentType: string;
  lastModified: string;
}

const BUCKET_KEY  = "s3_buckets_data";
const OBJECTS_KEY = "s3_objects_data";

const REGIONS = ["us-east-1", "us-west-2", "eu-west-1", "eu-central-1", "ap-southeast-1", "ap-northeast-1"];

const DEMO_BUCKETS: Bucket[] = [
  { id: "1", name: "my-app-assets", region: "us-east-1", access: "public", createdAt: new Date(Date.now() - 86400000 * 30).toISOString(), objectCount: 42, size: "1.4 GB" },
  { id: "2", name: "backups-prod",  region: "eu-west-1", access: "private", createdAt: new Date(Date.now() - 86400000 * 90).toISOString(), objectCount: 8, size: "23 GB" },
];
const DEMO_OBJECTS: S3Object[] = [
  { id: "1", bucketId: "1", key: "images/logo.png",       size: "42 KB",  contentType: "image/png",        lastModified: new Date(Date.now() - 3600000).toISOString() },
  { id: "2", bucketId: "1", key: "images/banner.jpg",     size: "210 KB", contentType: "image/jpeg",       lastModified: new Date(Date.now() - 7200000).toISOString() },
  { id: "3", bucketId: "1", key: "fonts/inter.woff2",     size: "88 KB",  contentType: "font/woff2",       lastModified: new Date(Date.now() - 86400000).toISOString() },
  { id: "4", bucketId: "2", key: "backup-2026-03-01.tar", size: "4.2 GB", contentType: "application/gzip", lastModified: new Date(Date.now() - 86400000 * 7).toISOString() },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getBuckets(): Bucket[] {
  try {
    const d = localStorage.getItem(BUCKET_KEY);
    if (!d) { localStorage.setItem(BUCKET_KEY, JSON.stringify(DEMO_BUCKETS)); return DEMO_BUCKETS; }
    return JSON.parse(d);
  } catch { return DEMO_BUCKETS; }
}
function saveBuckets(v: Bucket[]) { localStorage.setItem(BUCKET_KEY, JSON.stringify(v)); }

function getObjects(): S3Object[] {
  try {
    const d = localStorage.getItem(OBJECTS_KEY);
    if (!d) { localStorage.setItem(OBJECTS_KEY, JSON.stringify(DEMO_OBJECTS)); return DEMO_OBJECTS; }
    return JSON.parse(d);
  } catch { return DEMO_OBJECTS; }
}
function saveObjects(v: S3Object[]) { localStorage.setItem(OBJECTS_KEY, JSON.stringify(v)); }

function fileIcon(ct: string) {
  if (ct.startsWith("image/")) return "🖼️";
  if (ct.startsWith("video/")) return "🎬";
  if (ct.startsWith("audio/")) return "🎵";
  if (ct.includes("pdf"))      return "📄";
  if (ct.includes("zip") || ct.includes("gzip") || ct.includes("tar")) return "📦";
  if (ct.includes("json") || ct.includes("xml") || ct.includes("text")) return "📝";
  return "📁";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function S3Storage() {
  const [buckets, setBuckets] = useState<Bucket[]>(getBuckets);
  const [objects, setObjects] = useState<S3Object[]>(getObjects);
  const [selectedBucket, setSelectedBucket] = useState<Bucket | null>(null);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Create form
  const [form, setForm] = useState({ name: "", region: "us-east-1", access: "private" as "private" | "public" });
  // Upload form
  const [uploadKey, setUploadKey] = useState("");
  const [uploadType, setUploadType] = useState("text/plain");
  const [uploadSize, setUploadSize] = useState("");

  const { toast } = useToast();
  const confirm = useConfirm();

  const bucketObjects = selectedBucket ? objects.filter((o) => o.bucketId === selectedBucket.id) : [];
  const filteredBuckets = buckets.filter((b) => b.name.toLowerCase().includes(search.toLowerCase()));
  const filteredObjects = bucketObjects.filter((o) => o.key.toLowerCase().includes(search.toLowerCase()));

  // ── Bucket actions ──
  const createBucket = () => {
    if (!form.name.trim()) return;
    const clean = form.name.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (buckets.find((b) => b.name === clean)) { toast({ title: "Name taken", description: "Choose a different bucket name." }); return; }
    const b: Bucket = {
      id: crypto.randomUUID(), name: clean, region: form.region,
      access: form.access, createdAt: new Date().toISOString(), objectCount: 0, size: "0 B",
    };
    const updated = [b, ...buckets];
    setBuckets(updated); saveBuckets(updated);
    setShowCreate(false); setForm({ name: "", region: "us-east-1", access: "private" });
    toast({ title: "Bucket Created", description: clean });
  };

  const deleteBucket = async (id: string) => {
    const count = objects.filter((o) => o.bucketId === id).length;
    if (count > 0) {
      const ok = await confirm({
        title: "Delete bucket with objects?",
        description: `This bucket has ${count} object(s). They will be removed with the bucket.`,
        confirmLabel: "Delete",
        variant: "destructive",
      });
      if (!ok) return;
    }
    const updBuckets = buckets.filter((b) => b.id !== id);
    const updObjects = objects.filter((o) => o.bucketId !== id);
    setBuckets(updBuckets); saveBuckets(updBuckets);
    setObjects(updObjects); saveObjects(updObjects);
    if (selectedBucket?.id === id) setSelectedBucket(null);
    toast({ title: "Bucket Deleted" });
  };

  const copyEndpoint = (bucket: Bucket) => {
    const url = `https://${bucket.name}.s3.${bucket.region}.amazonaws.com`;
    navigator.clipboard.writeText(url);
    toast({ title: "Copied", description: url });
  };

  // ── Object actions ──
  const uploadObject = async () => {
    if (!selectedBucket || !uploadKey.trim()) return;
    setUploading(true);
    await new Promise((r) => setTimeout(r, 1200));
    const obj: S3Object = {
      id: crypto.randomUUID(), bucketId: selectedBucket.id,
      key: uploadKey.trim(), size: uploadSize.trim() || "—",
      contentType: uploadType, lastModified: new Date().toISOString(),
    };
    const updObjects = [obj, ...objects];
    setObjects(updObjects); saveObjects(updObjects);
    const updBuckets = buckets.map((b) =>
      b.id === selectedBucket.id ? { ...b, objectCount: b.objectCount + 1 } : b
    );
    setBuckets(updBuckets); saveBuckets(updBuckets);
    setUploading(false); setShowUpload(false);
    setUploadKey(""); setUploadType("text/plain"); setUploadSize("");
    toast({ title: "Object Uploaded", description: obj.key });
  };

  const deleteObject = (id: string) => {
    const obj = objects.find((o) => o.id === id);
    const updObjects = objects.filter((o) => o.id !== id);
    setObjects(updObjects); saveObjects(updObjects);
    if (obj && selectedBucket) {
      const updBuckets = buckets.map((b) =>
        b.id === selectedBucket.id ? { ...b, objectCount: Math.max(0, b.objectCount - 1) } : b
      );
      setBuckets(updBuckets); saveBuckets(updBuckets);
    }
    toast({ title: "Object Deleted" });
  };

  const copyObjectUrl = (obj: S3Object) => {
    if (!selectedBucket) return;
    const url = `https://${selectedBucket.name}.s3.${selectedBucket.region}.amazonaws.com/${obj.key}`;
    navigator.clipboard.writeText(url);
    toast({ title: "URL Copied" });
  };

  const totalSize = buckets.reduce((acc) => acc, 0);
  const totalObjects = objects.length;

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          {selectedBucket && (
            <button onClick={() => { setSelectedBucket(null); setSearch(""); }}
              className="p-2 rounded-xl hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <HardDrive className="w-7 h-7 text-primary" />
              {selectedBucket ? selectedBucket.name : "S3 Storage"}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {selectedBucket
                ? `${selectedBucket.region} · ${selectedBucket.access} · ${bucketObjects.length} objects`
                : `${buckets.length} buckets · ${totalObjects} objects`
              }
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedBucket ? (
            <button onClick={() => setShowUpload(true)} className="btn-primary flex items-center gap-2">
              <Upload className="w-4 h-4" />Upload Object
            </button>
          ) : (
            <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" />New Bucket
            </button>
          )}
        </div>
      </div>

      {/* Create bucket form */}
      <AnimatePresence>
        {showCreate && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="glass-panel rounded-xl p-5 border border-primary/20 mb-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-primary" />Create New Bucket
            </h3>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="col-span-1">
                <label className="text-xs text-muted-foreground mb-1 block">Bucket Name</label>
                <input className="input-field font-mono text-sm" placeholder="my-bucket-name" value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <p className="text-[10px] text-muted-foreground mt-1">Lowercase, letters, numbers, hyphens only</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Region</label>
                <select className="input-field" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}>
                  {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Access</label>
                <select className="input-field" value={form.access}
                  onChange={(e) => setForm({ ...form, access: e.target.value as "private" | "public" })}>
                  <option value="private">Private</option>
                  <option value="public">Public</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="btn-secondary text-sm">Cancel</button>
              <button onClick={createBucket} disabled={!form.name.trim()} className="btn-primary text-sm disabled:opacity-50">Create Bucket</button>
            </div>
          </motion.div>
        )}

        {/* Upload object form */}
        {showUpload && selectedBucket && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="glass-panel rounded-xl p-5 border border-primary/20 mb-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <Upload className="w-4 h-4 text-primary" />Upload Object to <span className="text-primary">{selectedBucket.name}</span>
            </h3>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="col-span-1">
                <label className="text-xs text-muted-foreground mb-1 block">Object Key (Path)</label>
                <input className="input-field font-mono text-sm" placeholder="folder/filename.txt" value={uploadKey}
                  onChange={(e) => setUploadKey(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Content Type</label>
                <select className="input-field" value={uploadType} onChange={(e) => setUploadType(e.target.value)}>
                  <option value="text/plain">text/plain</option>
                  <option value="image/png">image/png</option>
                  <option value="image/jpeg">image/jpeg</option>
                  <option value="application/json">application/json</option>
                  <option value="application/pdf">application/pdf</option>
                  <option value="application/gzip">application/gzip</option>
                  <option value="video/mp4">video/mp4</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Size <span className="text-muted-foreground/50">(optional)</span></label>
                <input className="input-field" placeholder="e.g. 2.4 MB" value={uploadSize}
                  onChange={(e) => setUploadSize(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowUpload(false)} className="btn-secondary text-sm">Cancel</button>
              <button onClick={uploadObject} disabled={uploading || !uploadKey.trim()}
                className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50">
                {uploading ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Uploading...</> : <><Upload className="w-3.5 h-3.5" />Upload</>}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats bar */}
      {!selectedBucket && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="glass-panel rounded-xl p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Buckets</p>
            <p className="text-2xl font-bold text-primary">{buckets.length}</p>
          </div>
          <div className="glass-panel rounded-xl p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total Objects</p>
            <p className="text-2xl font-bold">{totalObjects}</p>
          </div>
          <div className="glass-panel rounded-xl p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Regions</p>
            <p className="text-2xl font-bold">{[...new Set(buckets.map((b) => b.region))].length}</p>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input className="input-field !pl-10 w-full"
          placeholder={selectedBucket ? "Search objects..." : "Search buckets..."}
          value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {/* ── Bucket list ── */}
      {!selectedBucket && (
        filteredBuckets.length === 0 ? (
          <div className="glass-panel rounded-2xl p-12 text-center">
            <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
              <HardDrive className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="font-semibold mb-1">No buckets yet</h3>
            <p className="text-muted-foreground text-sm mb-5">Create your first S3 bucket to get started.</p>
            <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 mx-auto">
              <Plus className="w-4 h-4" />New Bucket
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredBuckets.map((bucket, i) => (
              <motion.div key={bucket.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="glass-panel rounded-xl p-5 flex items-center justify-between gap-4 group cursor-pointer hover:bg-white/[0.03] transition-colors"
                onClick={() => { setSelectedBucket(bucket); setSearch(""); }}>
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                    <FolderOpen className="w-5 h-5 text-amber-400" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-mono font-semibold text-sm">{bucket.name}</span>
                      <span className={`text-[10px] border rounded-full px-2 py-0.5 flex items-center gap-1 ${
                        bucket.access === "public"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
                      }`}>
                        {bucket.access === "public" ? <Globe className="w-2.5 h-2.5" /> : <Lock className="w-2.5 h-2.5" />}
                        {bucket.access}
                      </span>
                      <span className="text-[10px] text-muted-foreground bg-white/5 border border-white/5 rounded-full px-2 py-0.5">
                        {bucket.region}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {bucket.objectCount} objects · {bucket.size} · Created {format(new Date(bucket.createdAt), "MMM d, yyyy")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={(e) => { e.stopPropagation(); copyEndpoint(bucket); }}
                    className="opacity-0 group-hover:opacity-100 p-2 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-foreground transition-all" title="Copy endpoint">
                    <Copy className="w-4 h-4" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); deleteBucket(bucket.id); }}
                    className="opacity-0 group-hover:opacity-100 p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all" title="Delete bucket">
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </motion.div>
            ))}
          </div>
        )
      )}

      {/* ── Object list ── */}
      {selectedBucket && (
        filteredObjects.length === 0 ? (
          <div className="glass-panel rounded-2xl p-12 text-center">
            <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
              <File className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="font-semibold mb-1">No objects in this bucket</h3>
            <p className="text-muted-foreground text-sm mb-5">Upload your first object to get started.</p>
            <button onClick={() => setShowUpload(true)} className="btn-primary flex items-center gap-2 mx-auto">
              <Upload className="w-4 h-4" />Upload Object
            </button>
          </div>
        ) : (
          <div className="glass-panel rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Key</th>
                  <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Type</th>
                  <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Size</th>
                  <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Modified</th>
                  <th className="py-3 px-5 w-24"></th>
                </tr>
              </thead>
              <tbody>
                {filteredObjects.map((obj, i) => (
                  <motion.tr key={obj.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                    className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors group">
                    <td className="py-3.5 px-5">
                      <div className="flex items-center gap-2.5">
                        <span className="text-lg leading-none">{fileIcon(obj.contentType)}</span>
                        <span className="font-mono text-sm">{obj.key}</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-5">
                      <span className="text-xs text-muted-foreground font-mono bg-white/5 border border-white/5 rounded-full px-2 py-0.5">
                        {obj.contentType}
                      </span>
                    </td>
                    <td className="py-3.5 px-5"><span className="text-sm text-muted-foreground">{obj.size}</span></td>
                    <td className="py-3.5 px-5">
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(obj.lastModified), "MMM d, yyyy HH:mm")}
                      </span>
                    </td>
                    <td className="py-3.5 px-5">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                        <button onClick={() => copyObjectUrl(obj)}
                          className="p-1.5 rounded-md hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors" title="Copy URL">
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          className="p-1.5 rounded-md hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors" title="Download">
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => deleteObject(obj.id)}
                          className="p-1.5 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </>
  );
}
