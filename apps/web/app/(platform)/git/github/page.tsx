"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { ExternalLink, GitBranch, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { API_BASE } from "@/lib/api";
import { fetchGitSettings, type GitSettingsPublic } from "@/lib/git-api";
import { GitBreadcrumb } from "../_components/git-breadcrumb";

function githubManifestRegisterUrl(): string {
  const manifestUrl = `${API_BASE}/api/git/github/manifest`;
  return `https://github.com/settings/apps/new?manifest_url=${encodeURIComponent(manifestUrl)}`;
}

export default function GitHubGitSettingsPage() {
  const { accessToken } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<GitSettingsPublic | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const s = await fetchGitSettings(accessToken);
      setData(s);
    } catch (e) {
      toast({
        title: "Could not load Git settings",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [accessToken, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  const manifestHref = githubManifestRegisterUrl();
  const connected =
    Boolean(data?.github.appId?.trim()) ||
    Boolean(data?.github.clientId?.trim()) ||
    Boolean(data?.github.clientSecretSet || data?.github.privateKeySet);

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-12">
      <GitBreadcrumb current="github" />

      <div className="flex items-start gap-4">
        <div className="rounded-2xl border border-zinc-200/90 bg-white p-3 shadow-md shadow-zinc-900/5 dark:border-white/10 dark:bg-zinc-950 dark:shadow-lg shrink-0">
          <Image
            src="/deployment-sources/github.svg"
            alt=""
            width={56}
            height={56}
            className="h-14 w-14 object-contain dark:invert"
          />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">GitHub</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl leading-relaxed">
            Register a GitHub App using the manifest from this platform. After you finish on GitHub,
            you are redirected back and credentials are saved automatically.
          </p>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-blue-500/25 bg-gradient-to-br from-blue-500/10 via-card/50 to-transparent p-6 md:p-8">
        <div className="absolute -right-20 -top-20 h-40 w-40 rounded-full bg-blue-400/20 blur-3xl pointer-events-none" />
        <div className="relative space-y-5">
          <h2 className="text-lg font-semibold">Create GitHub App on GitHub</h2>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
            Opens GitHub with a manifest loaded from this Weehawk API. Complete the flow on GitHub;
            when done, GitHub sends you back here and we store the app credentials.
          </p>
          <a
            href={manifestHref}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary inline-flex items-center gap-2.5 !py-2.5 !px-5 w-fit"
          >
            <GitBranch className="w-5 h-5" />
            Create GitHub App on GitHub
            <ExternalLink className="w-4 h-4 opacity-80" />
          </a>
        </div>
      </div>

      {data ? (
        <div className="glass-panel rounded-xl border border-white/10 px-4 py-3 text-sm">
          <p className="text-muted-foreground">
            Status:{" "}
            <span className={connected ? "text-emerald-400/90 font-medium" : "text-muted-foreground"}>
              {connected ? "GitHub App credentials saved" : "Not connected yet"}
            </span>
            {data.github.appId ? (
              <span className="text-muted-foreground ml-2">· App ID {data.github.appId}</span>
            ) : null}
            {connected && data.updatedAt ? (
              <span className="block text-[11px] text-muted-foreground/80 mt-1">
                Last updated {new Date(data.updatedAt).toLocaleString()}
              </span>
            ) : null}
          </p>
        </div>
      ) : null}
    </div>
  );
}
