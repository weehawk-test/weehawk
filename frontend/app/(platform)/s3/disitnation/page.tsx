"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { HardDrive, Loader2, PlugZap, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  saveS3ProfileApi,
  testS3ConnectionApi,
  type S3ProfilePayload,
} from "@/lib/s3-api";

export default function S3DisitnationPage() {
  const sp = useSearchParams();
  const { toast } = useToast();
  const [form, setForm] = useState<S3ProfilePayload>({
    name: sp.get("name") ?? "",
    endpoint: sp.get("endpoint") ?? "",
    region: sp.get("region") ?? "us-east-1",
    bucket: sp.get("bucket") ?? "",
    accessKeyId: sp.get("accessKeyId") ?? "",
    secretAccessKey: "",
    forcePathStyle: sp.get("forcePathStyle") === "true",
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

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
      toast({
        title: "S3 destination saved",
        description: `Saved "${res.profile.name}" successfully.`,
      });
      setForm((prev) => ({ ...prev, secretAccessKey: "" }));
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

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2 flex items-center gap-2">
            <HardDrive className="w-7 h-7 text-primary" />
            S3 Destination
          </h1>
          <p className="text-muted-foreground">
            Add or update S3 destination credentials for rclone.
          </p>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <Link href="/s3/disitnation" className="btn-secondary text-sm">
          Add Destination
        </Link>
        <Link href="/s3/saved" className="btn-secondary text-sm">
          Saved Destinations
        </Link>
      </div>

      <section className="glass-panel rounded-2xl p-6 border border-primary/20">
        <div className="mb-5">
          <h2 className="text-lg font-semibold">Add Destination</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Enter endpoint and credentials, verify the connection, then save.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Name</label>
            <input
              className="input-field"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="prod-backups"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Region</label>
            <input
              className="input-field"
              value={form.region}
              onChange={(e) => setForm((prev) => ({ ...prev, region: e.target.value }))}
              placeholder="us-east-1"
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-sm font-medium mb-1.5 block">Endpoint</label>
            <input
              className="input-field font-mono"
              value={form.endpoint}
              onChange={(e) => setForm((prev) => ({ ...prev, endpoint: e.target.value }))}
              placeholder="https://s3.amazonaws.com or https://minio.example.com"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Bucket</label>
            <input
              className="input-field"
              value={form.bucket}
              onChange={(e) => setForm((prev) => ({ ...prev, bucket: e.target.value }))}
              placeholder="my-bucket"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Access Key ID</label>
            <input
              className="input-field"
              value={form.accessKeyId}
              onChange={(e) => setForm((prev) => ({ ...prev, accessKeyId: e.target.value }))}
              placeholder="AKIA..."
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-sm font-medium mb-1.5 block">Secret Access Key</label>
            <input
              type="password"
              className="input-field"
              value={form.secretAccessKey}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, secretAccessKey: e.target.value }))
              }
              placeholder="Your secret access key"
            />
          </div>
          <div className="md:col-span-2">
            <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={Boolean(form.forcePathStyle)}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, forcePathStyle: e.target.checked }))
                }
              />
              Enable force path style (recommended for MinIO/R2)
            </label>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-6">
          <button
            type="button"
            onClick={onTest}
            disabled={!canSubmit || testing}
            className="btn-secondary flex items-center gap-2 disabled:opacity-50"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />}
            Verify
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!canSubmit || saving}
            className="btn-primary flex items-center gap-2 disabled:opacity-50 ml-auto"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>
        </div>
      </section>
    </>
  );
}
