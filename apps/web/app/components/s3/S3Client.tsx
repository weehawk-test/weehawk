"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { HardDrive, Plus, Search, Trash2, Loader2, PlugZap, Save, X, Pencil, Clock, FolderOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { useBulkSelection } from "@/components/docker/useBulkSelection";
import { DockerBulkCheckbox } from "@/components/docker/DockerBulkCheckbox";
import {
  deleteS3ProfileApi,
  listS3ProfilesApi,
  saveS3ProfileApi,
  s3ProfileRouteId,
  testS3ConnectionApi,
  type S3ProfileFormState,
  type S3ProfilePayload,
  type S3ProfilePublic,
} from "@/lib/s3-api";
import { fetchRemoteServers, type RemoteServerRow } from "@/lib/remote-servers-api";
import { inferS3ForcePathStyle } from "@/lib/s3-force-path-style";
import { useOptionalOrgWorkspace } from "@/(platform)/org-workspace/org-workspace-context";
import {
  orgMemberAllowsS3Add,
  orgMemberAllowsS3Browse,
  orgMemberAllowsS3Edit,
} from "@/lib/org-workspace-permissions";

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

export function S3Client({
  initialProfiles,
  initialError,
  activeOrgPublicId = null,
}: {
  initialProfiles: S3ProfilePublic[];
  initialError: string | null;
  activeOrgPublicId?: string | null;
}) {
  const orgTrim = activeOrgPublicId?.trim();
  const s3QueryOrg = orgTrim && orgTrim.length > 0 ? orgTrim : null;
  const s3BasePath = "/s3";
  const inOrgS3 = orgTrim != null && orgTrim !== "";
  const orgWorkspace = useOptionalOrgWorkspace();
  const allowS3Browse =
    !inOrgS3 ||
    (orgWorkspace != null && orgMemberAllowsS3Browse(orgWorkspace.workspacePermissions));
  const allowS3Add =
    !inOrgS3 || (orgWorkspace != null && orgMemberAllowsS3Add(orgWorkspace.workspacePermissions));
  const allowS3Edit =
    !inOrgS3 || (orgWorkspace != null && orgMemberAllowsS3Edit(orgWorkspace.workspacePermissions));
  const { toast } = useToast();
  const { accessToken } = useAuth();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const profilesQuery = useQuery({
    queryKey: ["s3-profiles", s3QueryOrg],
    queryFn: () => listS3ProfilesApi(),
    enabled: Boolean(accessToken && s3QueryOrg),
    initialData: s3QueryOrg ? initialProfiles : undefined,
  });
  const profiles = profilesQuery.data ?? [];
  const listLoading = Boolean(s3QueryOrg && profilesQuery.isLoading && !profilesQuery.data);
  const [search, setSearch] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [provider, setProvider] = useState("custom");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  /** `null` = verify from the API server (default). */
  const [s3VerifyRemoteId, setS3VerifyRemoteId] = useState<number | null>(null);
  const [deployServersForTest, setDeployServersForTest] = useState<RemoteServerRow[]>([]);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [form, setForm] = useState<S3ProfileFormState>({
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

  useEffect(() => {
    if (!isAddOpen || !accessToken) return;
    let cancelled = false;
    void fetchRemoteServers(accessToken)
      .then((rows) => {
        if (!cancelled) {
          setDeployServersForTest(rows.filter((r) => r.serverRole === "deploy"));
        }
      })
      .catch(() => {
        if (!cancelled) setDeployServersForTest([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isAddOpen, accessToken, activeOrgPublicId]);

  const canSubmit = useMemo(() => {
    if (!orgTrim) return false;
    const base =
      form.name.trim() &&
      form.endpoint.trim() &&
      form.region.trim() &&
      form.bucket.trim() &&
      form.accessKeyId.trim();
    if (!base) return false;
    if (!(form.secretAccessKey ?? "").trim()) return false;
    return true;
  }, [form, orgTrim]);

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

  const closeModal = () => {
    setIsAddOpen(false);
    setS3VerifyRemoteId(null);
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

  const payloadForApi = useMemo((): S3ProfilePayload | null => {
    if (!orgTrim) return null;
    const forcePathStyle = inferS3ForcePathStyle(form.endpoint);
    const secret = (form.secretAccessKey ?? "").trim();
    return {
      name: form.name.trim(),
      endpoint: form.endpoint.trim(),
      region: form.region.trim(),
      bucket: form.bucket.trim(),
      accessKeyId: form.accessKeyId.trim(),
      secretAccessKey: secret,
      forcePathStyle,
    };
  }, [form, orgTrim]);

  const onTest = async () => {
    if (!canSubmit || !payloadForApi) return;
    if (s3VerifyRemoteId == null) {
      toast({
        title: "Choose a deploy host",
        description: "Select which remote server should run the verification request.",
        variant: "destructive",
      });
      return;
    }
    setTesting(true);
    try {
      const res = await testS3ConnectionApi({
        ...payloadForApi,
        remoteServerId: s3VerifyRemoteId,
      });
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
    if (!canSubmit || !payloadForApi) return;
    setSaving(true);
    try {
      const res = await saveS3ProfileApi(payloadForApi);
      toast({
        title: "Destination saved",
        description: `Saved "${res.profile.name}".`,
      });
      closeModal();
      void queryClient.invalidateQueries({ queryKey: ["s3-profiles", s3QueryOrg] });
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
      const target = profiles.find((p) => p.name === name);
      if (!target) throw new Error("S3 destination not found.");
      await deleteS3ProfileApi(s3ProfileRouteId(target));
      toast({ title: "Deleted", description: name });
      void queryClient.invalidateQueries({ queryKey: ["s3-profiles", s3QueryOrg] });
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
      await Promise.all(
        names.map((name) => {
          const target = profiles.find((p) => p.name === name);
          if (!target) throw new Error(`S3 destination "${name}" not found.`);
          return deleteS3ProfileApi(s3ProfileRouteId(target));
        }),
      );
      profilesBulk.clear();
      toast({ title: "Destinations deleted", description: `${names.length} destination(s) removed.` });
      void queryClient.invalidateQueries({ queryKey: ["s3-profiles", s3QueryOrg] });
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
        {allowS3Add ? (
          <Link href={`${s3BasePath}/create`} className="btn-primary flex items-center justify-center gap-2">
            <Plus className="w-5 h-5" /> Add destination
          </Link>
        ) : null}
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
        {allowS3Edit && filtered.length > 0 && (
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

      {listLoading ? (
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
          {!search && allowS3Add && (
            <Link href={`${s3BasePath}/create`} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" /> Add destination
            </Link>
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
                  {allowS3Edit ? (
                    <button
                      type="button"
                      onClick={() => void onDelete(item.name)}
                      disabled={deletingName === item.name || isBulkDeleting}
                      className="p-2 rounded-md hover:bg-destructive/20 text-destructive transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-100"
                      title="Delete"
                    >
                      {deletingName === item.name ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  ) : null}
                  {allowS3Edit ? (
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
                  ) : null}
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
                  {allowS3Edit ? (
                    <Link
                      href={`${s3BasePath}/${encodeURIComponent(s3ProfileRouteId(item))}/edit`}
                      className="text-primary hover:underline cursor-pointer font-medium flex items-center gap-1"
                    >
                      <Pencil className="w-3 h-3" />
                      Edit
                    </Link>
                  ) : null}
                  {allowS3Browse ? (
                    <Link
                      href={`${s3BasePath}/${encodeURIComponent(s3ProfileRouteId(item))}`}
                      className="text-primary hover:underline cursor-pointer font-medium flex items-center gap-1"
                    >
                      <FolderOpen className="w-3 h-3" />
                      Browse
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {typeof document !== "undefined" &&
        createPortal(
        <AnimatePresence>
          {isAddOpen && (
          <motion.div
            key="s3-add"
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
                    Add S3 destination
                  </h1>
                  <p className="text-sm text-muted-foreground mt-1">
                    Save a reusable S3 destination profile.
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
                    placeholder="Your secret key"
                  />
                </div>
              </div>

              <div className="relative z-10 mb-6 rounded-xl border border-primary/20 bg-primary/[0.06] p-4 md:p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
                <div className="flex flex-col gap-1 mb-3">
                  <span className="text-sm font-semibold text-foreground">Test connection</span>
                  <span className="text-xs text-muted-foreground">
                    Optional: verify from a deploy host (same network path as backups). Saving the destination does not
                    require a test.
                  </span>
                </div>
                <div>
                  <label htmlFor="s3-verify-from" className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Run test from <span className="font-normal text-muted-foreground/80">(optional)</span>
                  </label>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <select
                      id="s3-verify-from"
                      className="input-field-sm w-full sm:flex-1 min-w-0 h-9 min-h-9 py-0 text-sm leading-normal"
                      value={s3VerifyRemoteId ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setS3VerifyRemoteId(v === "" ? null : Number(v));
                      }}
                    >
                      <option value="">Select a deploy host…</option>
                      {deployServersForTest.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.host})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={onTest}
                      disabled={
                        !canSubmit ||
                        testing ||
                        saving ||
                        s3VerifyRemoteId == null ||
                        deployServersForTest.length === 0
                      }
                      className="btn-secondary text-sm border border-primary/40 text-primary inline-flex items-center justify-center gap-1.5 shrink-0 h-9 min-h-9 px-3 disabled:opacity-50"
                    >
                      {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5" />}
                      Verify
                    </button>
                  </div>
                </div>
                {deployServersForTest.length === 0 && (
                  <p className="text-[11px] text-muted-foreground mt-2.5">
                    Add a deploy server under Remote servers to enable verification from that host.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 relative z-10">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={!canSubmit || saving || testing}
                  className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save
                </button>
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
