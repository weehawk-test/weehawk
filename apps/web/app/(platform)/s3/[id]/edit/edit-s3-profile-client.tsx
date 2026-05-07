"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, PlugZap, Save, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { fetchRemoteServers, type RemoteServerRow } from "@/lib/remote-servers-api";
import { inferS3ForcePathStyle } from "@/lib/s3-force-path-style";
import {
  saveS3ProfileApi,
  testS3ConnectionApi,
  type S3ProfileFormState,
  type S3ProfilePayload,
  type S3ProfilePublic,
} from "@/lib/s3-api";

type Props = {
  profile: S3ProfilePublic;
  activeOrgPublicId?: string | null;
};

export function EditS3ProfileClient({ profile, activeOrgPublicId = null }: Props) {
  const orgTrim = activeOrgPublicId?.trim();
  const s3BasePath = "/s3";
  const router = useRouter();
  const { toast } = useToast();
  const { accessToken } = useAuth();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [s3VerifyRemoteId, setS3VerifyRemoteId] = useState<number | null>(null);
  const [deployServersForTest, setDeployServersForTest] = useState<RemoteServerRow[]>([]);
  const [form, setForm] = useState<S3ProfileFormState>({
    name: profile.name,
    endpoint: profile.endpoint,
    region: profile.region,
    bucket: profile.bucket,
    accessKeyId: profile.accessKeyId,
    secretAccessKey: "",
  });

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    void fetchRemoteServers(accessToken)
      .then((rows) => {
        if (!cancelled) setDeployServersForTest(rows.filter((r) => r.serverRole === "deploy"));
      })
      .catch(() => {
        if (!cancelled) setDeployServersForTest([]);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, activeOrgPublicId]);

  const canSubmit = useMemo(
    () =>
      Boolean(
        orgTrim &&
          form.name.trim() &&
          form.endpoint.trim() &&
          form.region.trim() &&
          form.bucket.trim() &&
          form.accessKeyId.trim(),
      ),
    [form, orgTrim],
  );

  const payloadForApi = useMemo((): S3ProfilePayload | null => {
    if (!orgTrim) return null;
    const forcePathStyle = inferS3ForcePathStyle(form.endpoint);
    const secret = (form.secretAccessKey ?? "").trim();
    const pid = profile.publicId?.trim();
    const base = {
      ...(pid ? { publicId: pid } : {}),
      name: form.name.trim(),
      endpoint: form.endpoint.trim(),
      region: form.region.trim(),
      bucket: form.bucket.trim(),
      accessKeyId: form.accessKeyId.trim(),
      forcePathStyle,
    };
    if (!secret) return base;
    return { ...base, secretAccessKey: secret };
  }, [form, orgTrim, profile.publicId]);

  const onTest = async () => {
    if (!canSubmit || !payloadForApi) return;
    if (!(form.secretAccessKey ?? "").trim()) {
      toast({
        title: "Secret required",
        description: "Enter the secret access key to verify the connection.",
        variant: "destructive",
      });
      return;
    }
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
        title: "Destination updated",
        description: `Updated "${res.profile.name}".`,
      });
      router.push(s3BasePath);
      router.refresh();
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

  if (typeof document === "undefined") return null;

  const closeModal = () => {
    if (saving || testing) return;
    router.push(s3BasePath);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[80] overflow-y-auto modal-scrim flex min-h-full items-start justify-center px-4 py-6 md:px-6 md:py-8"
      onClick={closeModal}
    >
      <div className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="glass-panel p-6 md:p-8 rounded-2xl relative overflow-hidden">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground">Edit S3 destination</h1>
              <p className="text-sm text-muted-foreground mt-1">Update connection details for this profile.</p>
            </div>
            <Link href={s3BasePath} aria-label="Close">
              <button
                type="button"
                aria-label="Close"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </Link>
          </div>

          <div className="relative z-10">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
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
                <input
                  className="input-field"
                  value={form.region}
                  onChange={(e) => setForm((p) => ({ ...p, region: e.target.value }))}
                  placeholder="us-east-1"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-medium mb-1.5 block">Endpoint</label>
                <input
                  className="input-field font-mono"
                  value={form.endpoint}
                  onChange={(e) => setForm((p) => ({ ...p, endpoint: e.target.value }))}
                  placeholder="https://s3.amazonaws.com"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Bucket</label>
                <input
                  className="input-field"
                  value={form.bucket}
                  onChange={(e) => setForm((p) => ({ ...p, bucket: e.target.value }))}
                  placeholder="my-bucket"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Access Key ID</label>
                <input
                  className="input-field"
                  value={form.accessKeyId}
                  onChange={(e) => setForm((p) => ({ ...p, accessKeyId: e.target.value }))}
                  placeholder="AKIA..."
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-medium mb-1.5 block">Secret Access Key</label>
                <input
                  type="password"
                  className="input-field"
                  value={form.secretAccessKey}
                  onChange={(e) => setForm((p) => ({ ...p, secretAccessKey: e.target.value }))}
                  placeholder="Leave blank to keep existing secret"
                />
                <p className="text-[11px] text-muted-foreground mt-1.5">Current: {profile.secretAccessKeyMasked}</p>
              </div>
            </div>

            <div className="mb-6 rounded-xl border border-primary/20 bg-primary/[0.06] p-4 md:p-5">
              <div className="flex flex-col gap-1 mb-3">
                <span className="text-sm font-semibold text-foreground">Test connection</span>
                <span className="text-xs text-muted-foreground">
                  Optional: verify from a deploy host (same network path as backups).
                </span>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <select
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
                  disabled={!canSubmit || testing || saving || s3VerifyRemoteId == null || deployServersForTest.length === 0}
                  className="btn-secondary text-sm border border-primary/40 text-primary inline-flex items-center justify-center gap-1.5 shrink-0 h-9 min-h-9 px-3 disabled:opacity-50"
                >
                  {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5" />}
                  Verify
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Link href={s3BasePath} className="btn-secondary text-sm">
                Cancel
              </Link>
              <button
                type="button"
                onClick={onSave}
                disabled={!canSubmit || saving || testing}
                className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save changes
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
