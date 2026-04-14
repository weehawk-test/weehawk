"use client";

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { Loader2, Save } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import {
  fetchGitSettings,
  updateGitSettings,
  type GitSettingsPublic,
  type UpdateGitSettingsPayload,
} from "@/lib/git-api";
import { SecretHint } from "../_components/secret-hint";
import { GitBreadcrumb } from "../_components/git-breadcrumb";

export default function GitLabGitSettingsPage() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<GitSettingsPublic | null>(null);

  const [gitlabBaseUrl, setGitlabBaseUrl] = useState("https://gitlab.com");
  const [gitlabGroupAccessToken, setGitlabGroupAccessToken] = useState("");

  const load = useCallback(async () => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const s = await fetchGitSettings(accessToken);
      setData(s);
      setGitlabBaseUrl(s.gitlab.baseUrl ?? "https://gitlab.com");
      setGitlabGroupAccessToken("");
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

  const saveGitlab = async () => {
    if (!accessToken) return;
    setSaving(true);
    try {
      const payload: UpdateGitSettingsPayload = {
        gitlabBaseUrl: gitlabBaseUrl.trim() || "https://gitlab.com",
      };
      if (gitlabGroupAccessToken.trim())
        payload.gitlabGroupAccessToken = gitlabGroupAccessToken.trim();
      const next = await updateGitSettings(accessToken, payload);
      setData(next);
      setGitlabGroupAccessToken("");
      void queryClient.invalidateQueries({ queryKey: ["git-settings"] });
      toast({ title: "GitLab settings saved" });
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

  const clearField = async (field: keyof UpdateGitSettingsPayload) => {
    if (!accessToken) return;
    setSaving(true);
    try {
      const next = await updateGitSettings(accessToken, { [field]: "" } as UpdateGitSettingsPayload);
      setData(next);
      void queryClient.invalidateQueries({ queryKey: ["git-settings"] });
      toast({ title: "Secret cleared" });
    } catch (e) {
      toast({
        title: "Could not clear",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-12">
      <GitBreadcrumb current="gitlab" />

      <div className="flex items-start gap-4">
        <div className="rounded-2xl border border-zinc-200/90 bg-white p-3 shadow-md shadow-zinc-900/5 dark:border-orange-500/25 dark:bg-gradient-to-br dark:from-orange-950/50 dark:to-zinc-950 dark:shadow-lg shrink-0">
          <Image
            src="/deployment-sources/gitlab.svg"
            alt=""
            width={56}
            height={56}
            className="h-14 w-14 object-contain"
          />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">GitLab</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl leading-relaxed">
            Configure your GitLab instance URL and a <strong className="text-foreground/90 font-medium">personal or group access token</strong> for listing projects and cloning into application services.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-amber-600/25 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-950 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-100/95">
        <p className="mb-1 font-medium text-amber-950 dark:text-amber-50">Access token</p>
        <p className="text-[13px] text-amber-900/90 dark:text-amber-100/85">
          Create a{" "}
          <a
            href="https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-amber-950 underline underline-offset-2 hover:text-foreground dark:text-amber-50"
          >
            Personal Access Token
          </a>{" "}
          (or a{" "}
          <a
            href="https://docs.gitlab.com/ee/user/group/settings/group_access_tokens.html"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-amber-950 underline underline-offset-2 hover:text-foreground dark:text-amber-50"
          >
            Group access token
          </a>
          )           with at least{" "}
          <code className="rounded bg-amber-100/90 px-1 text-[11px] text-amber-950 dark:bg-black/30 dark:text-amber-100">
            read_api
          </code>
          ,{" "}
          <code className="rounded bg-amber-100/90 px-[3px] text-[11px] text-amber-950 dark:bg-black/30 dark:text-amber-100">
            api
          </code>{" "}
          (to register push webhooks for auto-deploy), and{" "}
          <code className="rounded bg-amber-100/90 px-[3px] text-[11px] text-amber-950 dark:bg-black/30 dark:text-amber-100">
            read_repository
          </code>{" "}
          for private repos. Paste it below and save.
        </p>
      </div>

      <div className="glass-panel rounded-2xl p-6 md:p-8 space-y-5">
        <h2 className="text-base font-semibold">GitLab connection</h2>
        <p className="text-xs text-muted-foreground leading-relaxed -mt-2">
          This token is sent as <code className="text-[10px]">PRIVATE-TOKEN</code> to GitLab&apos;s API and used for authenticated <code className="text-[10px]">git clone</code> when needed.
        </p>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">GitLab base URL</label>
          <input
            className="input-field w-full"
            value={gitlabBaseUrl}
            onChange={(e) => setGitlabBaseUrl(e.target.value)}
            placeholder="https://gitlab.com"
            autoComplete="off"
          />
          <p className="text-[11px] text-muted-foreground/90">
            Must match the instance where the token was created (self-hosted: your GitLab root URL, no trailing slash).
          </p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-medium text-foreground">Personal or group access token</label>
            <SecretHint set={data?.gitlab.groupAccessTokenSet ?? false} />
          </div>
          <input
            type="password"
            className="input-field w-full font-mono text-sm"
            value={gitlabGroupAccessToken}
            onChange={(e) => setGitlabGroupAccessToken(e.target.value)}
            placeholder="glpat-xxxxxxxx (or group token)"
            autoComplete="new-password"
          />
          {data?.gitlab.groupAccessTokenSet ? (
            <button
              type="button"
              className="text-[11px] text-destructive/80 hover:text-destructive"
              disabled={saving}
              onClick={() => void clearField("gitlabGroupAccessToken")}
            >
              Clear access token
            </button>
          ) : null}
        </div>

        <button
          type="button"
          disabled={saving}
          onClick={() => void saveGitlab()}
          className="btn-primary inline-flex items-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save GitLab
        </button>
        {data?.gitlab.groupAccessTokenSet && data.updatedAt ? (
          <p className="text-[11px] text-muted-foreground pt-1">
            Last updated {new Date(data.updatedAt).toLocaleString()}
          </p>
        ) : null}
      </div>
    </div>
  );
}
