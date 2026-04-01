"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { HardDrive, Plus, Search, Trash2, Loader2, PlugZap, Save, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { useBulkSelection } from "@/components/docker/useBulkSelection";
import { DockerBulkCheckbox } from "@/components/docker/DockerBulkCheckbox";
import {
  deleteS3ProfileApi,
  listS3ProfilesApi,
  saveS3ProfileApi,
  testS3ConnectionApi,
  type S3ProfilePayload,
  type S3ProfilePublic,
} from "@/lib/s3-api";

type S3ProviderPreset = {
  id: string;
  label: string;
  endpoint: string;
  region: string;
  forcePathStyle: boolean;
};

const S3_PROVIDER_PRESETS: S3ProviderPreset[] = [
  { id: "aws-s3", label: "Amazon S3", endpoint: "https://s3.amazonaws.com", region: "us-east-1", forcePathStyle: false },
  { id: "cloudflare-r2", label: "Cloudflare R2", endpoint: "https://<account-id>.r2.cloudflarestorage.com", region: "auto", forcePathStyle: true },
  { id: "minio", label: "MinIO", endpoint: "http://localhost:9000", region: "us-east-1", forcePathStyle: true },
  { id: "digitalocean-spaces", label: "DigitalOcean Spaces", endpoint: "https://nyc3.digitaloceanspaces.com", region: "nyc3", forcePathStyle: false },
  { id: "wasabi", label: "Wasabi", endpoint: "https://s3.us-east-1.wasabisys.com", region: "us-east-1", forcePathStyle: false },
  { id: "backblaze-b2", label: "Backblaze B2 (S3)", endpoint: "https://s3.us-west-000.backblazeb2.com", region: "us-west-000", forcePathStyle: false },
];

export function S3Client({
  initialProfiles,
  initialError,
}: {
  initialProfiles: S3ProfilePublic[];
  initialError: string | null;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [profiles, setProfiles] = useState<S3ProfilePublic[]>(initialProfiles);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [provider, setProvider] = useState("custom");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [form, setForm] = useState<S3ProfilePayload>({
    name: "",
    endpoint: "",
    region: "us-east-1",
    bucket: "",
    accessKeyId: "",
    secretAccessKey: "",
    forcePathStyle: false,
  });

  useEffect(() => {
    if (initialError) {
      toast({
        title: "Load failed",
        description: initialError,
        variant: "destructive",
      });
    }
  }, [initialError, toast]);

  const canSubmit = useMemo(
    () =>
      form.name.trim() &&
      form.endpoint.trim() &&
      form.region.trim() &&
      form.bucket.trim() &&
      form.accessKeyId.trim() &&
      form.secretAccessKey.trim(),
    [form],
  );

  const filtered = profiles.filter((p) => {
    const q = search.toLowerCase().trim();
    return (
      p.name.toLowerCase().includes(q) ||
      p.endpoint.toLowerCase().includes(q) ||
      p.bucket.toLowerCase().includes(q) ||
      p.region.toLowerCase().includes(q)
    );
  });
  const profileKeys = useMemo(() => filtered.map((p) => p.name), [filtered]);
  const profilesBulk = useBulkSelection(profileKeys);

  const loadProfiles = async () => {
    setLoading(true);
    try {
      const list = await listS3ProfilesApi();
      setProfiles(list);
    } catch (e) {
      toast({
        title: "Load failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const closeAdd = () => {
    setShowAdd(false);
    setProvider("custom");
    setForm({
      name: "",
      endpoint: "",
      region: "us-east-1",
      bucket: "",
      accessKeyId: "",
      secretAccessKey: "",
      forcePathStyle: false,
    });
  };

  const applyProviderPreset = (providerId: string) => {
    setProvider(providerId);
    if (providerId === "custom") return;
    const preset = S3_PROVIDER_PRESETS.find((p) => p.id === providerId);
    if (!preset) return;
    setForm((prev) => ({
      ...prev,
      endpoint: preset.endpoint,
      region: preset.region,
      forcePathStyle: preset.forcePathStyle,
    }));
  };

  const onTest = async () => {
    if (!canSubmit) return;
    setTesting(true);
    try {
      const res = await testS3ConnectionApi(form);
      toast({ title: "Connection verified", description: res.message });
    } catch (e) {
      toast({
        title: "Verification failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  };

  const onSave = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const res = await saveS3ProfileApi(form);
      toast({ title: "Destination saved", description: `Saved "${res.profile.name}".` });
      closeAdd();
      await loadProfiles();
    } catch (e) {
      toast({
        title: "Save failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (name: string) => {
    const ok = await confirm({
      title: "Delete destination?",
      description: `This will remove "${name}" from saved S3 destinations.`,
      confirmLabel: "Delete destination",
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingName(name);
    try {
      await deleteS3ProfileApi(name);
      toast({ title: "Deleted", description: name });
      await loadProfiles();
    } catch (e) {
      toast({
        title: "Delete failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setDeletingName(null);
    }
  };
  const onBulkDelete = async () => {
    const names = profilesBulk.selectedInFiltered;
    if (names.length === 0) return;
    const ok = await confirm({
      title: "Delete selected destinations?",
      description: `Delete ${names.length} destination(s)?`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    setIsBulkDeleting(true);
    try {
      await Promise.all(names.map((name) => deleteS3ProfileApi(name)));
      profilesBulk.clear();
      toast({ title: "Destinations deleted", description: `${names.length} destination(s) removed.` });
      await loadProfiles();
    } catch (e) {
      toast({
        title: "Delete failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setIsBulkDeleting(false);
    }
  };

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">S3 Destinations</h1>
          <p className="text-muted-foreground">Manage saved S3 destinations and credentials.</p>
        </div>
        <button type="button" onClick={() => setShowAdd(true)} className="btn-primary flex items-center justify-center gap-2">
          <Plus className="w-5 h-5" /> Add destination
        </button>
      </div>

      <div className="mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search destinations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field !pl-10 w-full bg-card/50"
          />
        </div>
        {filtered.length > 0 && (
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <DockerBulkCheckbox
                checked={profilesBulk.allSelected ? true : profilesBulk.someSelected ? "indeterminate" : false}
                onCheckedChange={() => profilesBulk.toggleAllFiltered()}
                aria-label="Select all destinations on this page"
              />
              <span className="text-sm text-muted-foreground">
                Select all on this page ({filtered.length})
              </span>
            </div>
            {profilesBulk.selectedInFiltered.length > 0 && (
              <button
                type="button"
                onClick={onBulkDelete}
                disabled={isBulkDeleting || Boolean(deletingName)}
                className="btn-secondary border-destructive/40 text-destructive hover:bg-destructive/10 flex items-center gap-2 text-sm"
              >
                {isBulkDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete ({profilesBulk.selectedInFiltered.length})
              </button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading destinations...
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-panel backdrop-blur-none p-12 rounded-2xl flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
            <HardDrive className="w-10 h-10 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-bold mb-2">No S3 destinations yet</h3>
          <p className="text-muted-foreground mb-8 max-w-md">
            {search ? "No destinations match your search." : "Add your first S3 destination profile."}
          </p>
          {!search && (
            <button type="button" onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" /> Add destination
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map((item) => (
            <div key={item.name} className="glass-panel backdrop-blur-none rounded-2xl p-6 flex flex-col group interactive-card">
              <div className="flex justify-between items-start mb-4">
                <div className="min-w-0">
                  <h3 className="font-semibold text-lg leading-tight truncate" title={item.name}>
                    {item.name}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1 font-mono truncate" title={item.endpoint}>
                    {item.endpoint}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                  <button
                    type="button"
                    onClick={() => void onDelete(item.name)}
                    disabled={deletingName === item.name || isBulkDeleting}
                    className="p-2 rounded-md hover:bg-destructive/20 text-destructive transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-100"
                    title="Delete"
                  >
                    {deletingName === item.name ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                  <div
                    className={`transition-opacity ${
                      profilesBulk.selected.has(item.name) ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    <DockerBulkCheckbox
                      checked={profilesBulk.selected.has(item.name)}
                      onCheckedChange={() => profilesBulk.toggle(item.name)}
                      aria-label={`Select destination ${item.name}`}
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-1 text-sm text-muted-foreground">
                <p>{item.bucket} - {item.region}</p>
                <p className="font-mono text-xs">AK: {item.accessKeyId}</p>
                <p className="font-mono text-xs">Secret: {item.secretAccessKeyMasked}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-y-0 left-64 right-0 z-50 bg-black/60 backdrop-blur-[3px] flex items-center justify-center p-4"
            onClick={closeAdd}
          >
            <motion.div
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.98 }}
              className="w-full max-w-3xl max-h-[88vh] overflow-y-auto glass-panel rounded-2xl border border-primary/25 p-5 sm:p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 mb-5">
                <div>
                  <h3 className="text-base font-semibold">Add S3 Destination</h3>
                  <p className="text-xs text-muted-foreground mt-1">Save a reusable S3 destination profile.</p>
                </div>
                <button type="button" onClick={closeAdd} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Provider</label>
                  <select
                    className="input-field"
                    value={provider}
                    onChange={(e) => applyProviderPreset(e.target.value)}
                  >
                    <option value="custom">Custom (S3-compatible)</option>
                    {S3_PROVIDER_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Name</label>
                  <input className="input-field" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="prod-backups" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Region</label>
                  <input className="input-field" value={form.region} onChange={(e) => setForm((p) => ({ ...p, region: e.target.value }))} placeholder="us-east-1" />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium mb-1.5 block">Endpoint</label>
                  <input className="input-field font-mono" value={form.endpoint} onChange={(e) => setForm((p) => ({ ...p, endpoint: e.target.value }))} placeholder="https://s3.amazonaws.com" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Bucket</label>
                  <input className="input-field" value={form.bucket} onChange={(e) => setForm((p) => ({ ...p, bucket: e.target.value }))} placeholder="my-bucket" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Access Key ID</label>
                  <input className="input-field" value={form.accessKeyId} onChange={(e) => setForm((p) => ({ ...p, accessKeyId: e.target.value }))} placeholder="AKIA..." />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium mb-1.5 block">Secret Access Key</label>
                  <input type="password" className="input-field" value={form.secretAccessKey} onChange={(e) => setForm((p) => ({ ...p, secretAccessKey: e.target.value }))} placeholder="Your secret key" />
                </div>
                <div className="md:col-span-2">
                  <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <input type="checkbox" checked={Boolean(form.forcePathStyle)} onChange={(e) => setForm((p) => ({ ...p, forcePathStyle: e.target.checked }))} />
                    Enable force path style (MinIO/R2)
                  </label>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" onClick={onTest} disabled={!canSubmit || testing || saving} className="btn-secondary text-sm border border-primary/35 text-primary flex items-center gap-2 disabled:opacity-50">
                  {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5" />}
                  Verify
                </button>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={closeAdd} className="btn-secondary text-sm">Cancel</button>
                  <button type="button" onClick={onSave} disabled={!canSubmit || saving || testing} className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50">
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Save
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
