"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { HardDrive, Loader2, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { deleteS3ProfileApi, listS3ProfilesApi, type S3ProfilePublic } from "@/lib/s3-api";

export default function S3SavedPage() {
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<S3ProfilePublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingName, setDeletingName] = useState<string | null>(null);

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

  useEffect(() => {
    void loadProfiles();
  }, []);

  const onDelete = async (name: string) => {
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

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2 flex items-center gap-2">
            <HardDrive className="w-7 h-7 text-primary" />
            Saved S3 Destinations
          </h1>
          <p className="text-muted-foreground">
            Manage your reusable S3 destination profiles.
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

      <section className="glass-panel rounded-2xl p-6 border border-white/10">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : profiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No saved destinations yet. Add one from Add Destination.
          </p>
        ) : (
          <div className="space-y-2">
            {profiles.map((item) => (
              <div key={item.name} className="rounded-xl border border-white/10 p-3">
                <Link
                  href={`/s3/disitnation?name=${encodeURIComponent(item.name)}&endpoint=${encodeURIComponent(
                    item.endpoint,
                  )}&region=${encodeURIComponent(item.region)}&bucket=${encodeURIComponent(
                    item.bucket,
                  )}&accessKeyId=${encodeURIComponent(item.accessKeyId)}&forcePathStyle=${
                    item.forcePathStyle ? "true" : "false"
                  }`}
                  className="block"
                >
                  <p className="font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{item.endpoint}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.bucket} • {item.region}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Secret: {item.secretAccessKeyMasked}
                  </p>
                </Link>
                <div className="flex justify-end mt-2">
                  <button
                    type="button"
                    onClick={() => onDelete(item.name)}
                    disabled={deletingName === item.name}
                    className="p-1.5 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                    title="Remove saved destination"
                  >
                    {deletingName === item.name ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
