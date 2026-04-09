"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { HardDrive, Plus, Search, Trash2, Loader2, PlugZap, Save, X, Pencil, ChevronRight, Clock, FolderOpen } from "lucide-react";
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
import { inferS3ForcePathStyle } from "@/lib/s3-force-path-style";

/** Short provider label from endpoint host (card badges). */
function s3ProviderLabelFromEndpoint(endpoint: string): string {
  const raw = endpoint.trim();
  if (!raw) return "S3";
  try {
    const url = raw.includes("://") ? new URL(raw) : new URL(`https://${raw}`);
    const h = url.hostname.toLowerCase();
    if (h.includes("r2.cloudflarestorage.com") || h.endsWith(".r2.dev")) return "R2";
    if (h.includes("amazonaws.com")) return "AWS";
    if (h.includes("digitaloceanspaces.com")) return "Spaces";
    if (h.includes("wasabisys.com")) return "Wasabi";
    if (h.includes("backblazeb2.com")) return "B2";
    if (h === "localhost" || h.startsWith("127.") || h.includes("minio")) return "MinIO";
    if (h.includes("storage.googleapis.com")) return "GCS";
    return "S3";
  } catch {
    return "S3";
  }
}

/** e.g. f02e12ec…b65516ee for long keys; keeps short strings as-is. */
function shortenCredentialPreview(s: string, head = 4, tail = 4): string {
  const t = s.trim();
  if (t.length <= head + tail + 1) return t;
  return `${t.slice(0, head)}…${t.slice(-tail)}`;
}

type S3ProviderPreset = {
  id: string;
  label: string;
  endpoint: string;
  region: string;
};

function formatDateUTC(dateInput: string): string {
  const date = new Date(dateInput);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function profileCreatedAtIso(p: S3ProfilePublic): string {
  return p.createdAt ?? p.updatedAt;
}

const S3_PROVIDER_PRESETS: S3ProviderPreset[] = [
  { id: "aws-s3", label: "Amazon S3", endpoint: "https://s3.amazonaws.com", region: "us-east-1" },
  { id: "cloudflare-r2", label: "Cloudflare R2", endpoint: "https://<account-id>.r2.cloudflarestorage.com", region: "auto" },
  { id: "minio", label: "MinIO", endpoint: "http://localhost:9000", region: "us-east-1" },
  { id: "digitalocean-spaces", label: "DigitalOcean Spaces", endpoint: "https://nyc3.digitaloceanspaces.com", region: "nyc3" },
  { id: "wasabi", label: "Wasabi", endpoint: "https://s3.us-east-1.wasabisys.com", region: "us-east-1" },
  { id: "backblaze-b2", label: "Backblaze B2 (S3)", endpoint: "https://s3.us-west-000.backblazeb2.com", region: "us-west-000" },
];

type S3ModalState =
  | null
  | { type: "add" }
  | { type: "view"; profile: S3ProfilePublic }
  | { type: "edit"; profile: S3ProfilePublic };

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
  const [modal, setModal] = useState<S3ModalState>(null);
  const [provider, setProvider] = useState("custom");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [form, setForm] = useState<Omit<S3ProfilePayload, "forcePathStyle">>({
    name: "",
    endpoint: "",
    region: "us-east-1",
    bucket: "",
    accessKeyId: "",
    secretAccessKey: "",
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

  const secretRequired = modal?.type === "add";
  const canSubmit = useMemo(() => {
    const base =
      form.name.trim() &&
      form.endpoint.trim() &&
      form.region.trim() &&
      form.bucket.trim() &&
      form.accessKeyId.trim();
    if (!base) return false;
    if (secretRequired && !(form.secretAccessKey ?? "").trim()) return false;
    return true;
  }, [form, secretRequired]);

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

  const closeModal = () => {
    setModal(null);
    setProvider("custom");
    setForm({
      name: "",
      endpoint: "",
      region: "us-east-1",
      bucket: "",
      accessKeyId: "",
      secretAccessKey: "",
    });
  };

  const openEdit = (profile: S3ProfilePublic) => {
    setProvider("custom");
    setForm({
      name: profile.name,
      endpoint: profile.endpoint,
      region: profile.region,
      bucket: profile.bucket,
      accessKeyId: profile.accessKeyId,
      secretAccessKey: "",
    });
    setModal({ type: "edit", profile });
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
    }));
  };

  const payloadForApi = useMemo((): S3ProfilePayload => {
    const forcePathStyle = inferS3ForcePathStyle(form.endpoint);
    const secret = (form.secretAccessKey ?? "").trim();
    if (modal?.type === "edit" && !secret) {
      return {
        name: form.name.trim(),
        endpoint: form.endpoint.trim(),
        region: form.region.trim(),
        bucket: form.bucket.trim(),
        accessKeyId: form.accessKeyId.trim(),
        forcePathStyle,
      };
    }
    return {
      name: form.name.trim(),
      endpoint: form.endpoint.trim(),
      region: form.region.trim(),
      bucket: form.bucket.trim(),
      accessKeyId: form.accessKeyId.trim(),
      secretAccessKey: secret,
      forcePathStyle,
    };
  }, [form, modal?.type]);

  const onTest = async () => {
    if (!canSubmit) return;
    if (modal?.type === "edit" && !(form.secretAccessKey ?? "").trim()) {
      toast({
        title: "Secret required",
        description: "Enter the secret access key to verify the connection, or save without verifying.",
        variant: "destructive",
      });
      return;
    }
    setTesting(true);
    try {
      const res = await testS3ConnectionApi(payloadForApi);
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
      const res = await saveS3ProfileApi(payloadForApi);
      const isEdit = modal?.type === "edit";
      toast({
        title: isEdit ? "Destination updated" : "Destination saved",
        description: isEdit ? `Updated "${res.profile.name}".` : `Saved "${res.profile.name}".`,
      });
      closeModal();
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
          <p className="text-muted-foreground">
            Link your cloud storage buckets so backups and uploads know where to send data.
          </p>
        </div>
        <button type="button" onClick={() => setModal({ type: "add" })} className="btn-primary flex items-center justify-center gap-2">
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
            <button type="button" onClick={() => setModal({ type: "add" })} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" /> Add destination
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map((item) => (
            <div
              key={item.name}
              className="glass-panel backdrop-blur-none rounded-2xl p-6 flex flex-col group interactive-card"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                    <HardDrive className="w-5 h-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-lg leading-tight truncate" title={item.name}>
                      {item.name}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1 truncate" title={item.endpoint}>
                      {s3ProviderLabelFromEndpoint(item.endpoint)} · {item.region}
                    </p>
                  </div>
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

              <div className="space-y-2 text-sm text-muted-foreground mb-4">
                <p className="text-xs font-mono truncate" title={item.bucket}>
                  Bucket: {item.bucket}
                </p>
                <p className="text-xs font-mono truncate" title={item.accessKeyId}>
                  Access key: {shortenCredentialPreview(item.accessKeyId)}
                </p>
                <p className="text-xs font-mono truncate" title={item.secretAccessKeyMasked}>
                  Secret: {item.secretAccessKeyMasked}
                </p>
              </div>

              <div className="mt-auto pt-4 border-t border-white/5 flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span title="Created (UTC)">{formatDateUTC(profileCreatedAtIso(item))}</span>
                </div>
                <div className="flex items-center gap-3 flex-wrap justify-end">
                  <Link
                    href={`/s3/bucket?name=${encodeURIComponent(item.name)}`}
                    className="text-primary hover:underline cursor-pointer font-medium flex items-center gap-1"
                  >
                    <FolderOpen className="w-3 h-3" />
                    Browse
                  </Link>
                  <button
                    type="button"
                    onClick={() => openEdit(item)}
                    className="text-primary hover:underline cursor-pointer font-medium flex items-center gap-1"
                  >
                    Edit <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setModal({ type: "view", profile: item })}
                    className="text-primary hover:underline cursor-pointer font-medium flex items-center gap-1"
                  >
                    View <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {typeof document !== "undefined" &&
        createPortal(
        <AnimatePresence>
          {modal?.type === "view" && (
          <motion.div
            key="s3-view"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] overflow-y-auto modal-scrim flex min-h-full items-center justify-center p-4 md:p-6"
            onClick={closeModal}
          >
            <motion.div
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.98 }}
              className="w-full max-w-2xl max-h-[min(88vh,calc(100vh-3rem))] overflow-y-auto glass-panel p-6 md:p-8 rounded-2xl relative overflow-x-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-6 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="text-2xl md:text-3xl font-bold text-foreground">S3 destination</h1>
                  <p className="text-sm text-muted-foreground mt-1.5">Read-only details.</p>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  aria-label="Close"
                  className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6 text-sm relative z-10">
                <div className="md:col-span-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">Name</p>
                  <p className="text-base font-medium text-foreground break-all">{modal.profile.name}</p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">Endpoint</p>
                  <p className="font-mono text-sm text-foreground break-all leading-relaxed">{modal.profile.endpoint}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">Bucket</p>
                  <p className="text-base text-foreground break-all">{modal.profile.bucket}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">Region</p>
                  <p className="text-base text-foreground">{modal.profile.region}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">Access key ID</p>
                  <p className="font-mono text-sm text-foreground break-all">{modal.profile.accessKeyId}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">Secret</p>
                  <p className="font-mono text-sm text-foreground">{modal.profile.secretAccessKeyMasked}</p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">Addressing</p>
                  <p className="text-base text-foreground">
                    {modal.profile.forcePathStyle ? "Path-style" : "Virtual-hosted"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">Created (UTC)</p>
                  <p className="text-base text-foreground">{formatDateUTC(profileCreatedAtIso(modal.profile))}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">Updated (UTC)</p>
                  <p className="text-base text-foreground">{formatDateUTC(modal.profile.updatedAt)}</p>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap gap-2 justify-end relative z-10">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm">
                  Close
                </button>
                <Link
                  href={`/s3/bucket?name=${encodeURIComponent(modal.profile.name)}`}
                  className="btn-secondary text-sm inline-flex items-center gap-2"
                  onClick={closeModal}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  Browse bucket
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    const p = modal.profile;
                    closeModal();
                    openEdit(p);
                  }}
                  className="btn-primary text-sm flex items-center gap-2"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
        </AnimatePresence>,
        document.body,
        )}

      {typeof document !== "undefined" &&
        createPortal(
        <AnimatePresence>
          {(modal?.type === "add" || modal?.type === "edit") && (
          <motion.div
            key={modal.type === "edit" ? "s3-edit" : "s3-add"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] overflow-y-auto modal-scrim flex min-h-full items-center justify-center p-4 md:p-6"
            onClick={closeModal}
          >
            <motion.div
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.98 }}
              className="w-full max-w-2xl max-h-[min(88vh,calc(100vh-3rem))] overflow-y-auto glass-panel p-6 md:p-8 rounded-2xl relative overflow-x-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-6 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="text-2xl font-bold text-foreground">
                    {modal.type === "edit" ? "Edit S3 destination" : "Add S3 destination"}
                  </h1>
                  <p className="text-sm text-muted-foreground mt-1">
                    {modal.type === "edit" ? "Update connection details for this profile." : "Save a reusable S3 destination profile."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  aria-label="Close"
                  className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 relative z-10">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Provider</label>
                  <select
                    className="input-field"
                    value={provider}
                    disabled={modal.type === "edit"}
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
                  <input
                    className="input-field"
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="prod-backups"
                    disabled={modal.type === "edit"}
                    readOnly={modal.type === "edit"}
                  />
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
                  <input
                    type="password"
                    className="input-field"
                    value={form.secretAccessKey}
                    onChange={(e) => setForm((p) => ({ ...p, secretAccessKey: e.target.value }))}
                    placeholder={modal.type === "edit" ? "Leave blank to keep existing secret" : "Your secret key"}
                  />
                  {modal.type === "edit" && (
                    <p className="text-[11px] text-muted-foreground mt-1.5">Current: {modal.profile.secretAccessKeyMasked}</p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 relative z-10">
                <button type="button" onClick={onTest} disabled={!canSubmit || testing || saving} className="btn-secondary text-sm border border-primary/35 text-primary flex items-center gap-2 disabled:opacity-50">
                  {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5" />}
                  Verify
                </button>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={closeModal} className="btn-secondary text-sm">Cancel</button>
                  <button type="button" onClick={onSave} disabled={!canSubmit || saving || testing} className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50">
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    {modal.type === "edit" ? "Update" : "Save"}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
        </AnimatePresence>,
        document.body,
        )}
    </>
  );
}
