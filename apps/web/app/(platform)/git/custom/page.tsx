"use client";

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Globe2, Loader2, Save } from "lucide-react";
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

export default function CustomGitSettingsPage() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<GitSettingsPublic | null>(null);

  const [gitBaseUrl, setGitBaseUrl] = useState("");
  const [accessTokenValue, setAccessTokenValue] = useState("");
  const normalizedBaseUrl = gitBaseUrl.trim().toLowerCase().replace(/\/+$/, "");
  const isCustomContext = Boolean(normalizedBaseUrl && normalizedBaseUrl !== "https://gitlab.com");

  const load = useCallback(async () => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const s = await fetchGitSettings(accessToken);
      setData(s);
      setGitBaseUrl(s.gitlab.baseUrl ?? "");
      setAccessTokenValue("");
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

  const saveCustom = async () => {
    if (!accessToken) return;
    setSaving(true);
    try {
      const payload: UpdateGitSettingsPayload = {
        gitlabBaseUrl: gitBaseUrl.trim(),
      };
      if (accessTokenValue.trim()) payload.gitlabGroupAccessToken = accessTokenValue.trim();
      const next = await updateGitSettings(accessToken, payload);
      setData(next);
      setAccessTokenValue("");
      void queryClient.invalidateQueries({ queryKey: ["git-settings"] });
      toast({ title: "Custom Git settings saved" });
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
    <div className="w-full space-y-8 pb-12">
      <GitBreadcrumb current="custom" />

      <div className="flex items-start gap-4">
        <div className="rounded-2xl border border-zinc-200/90 bg-white p-3 shadow-md shadow-zinc-900/5 dark:border-sky-500/25 dark:bg-gradient-to-br dark:from-sky-950/40 dark:to-zinc-950 dark:shadow-lg shrink-0">
          <Globe2 className="h-14 w-14 text-sky-600 dark:text-sky-500" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Custom Git</h1>
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-6 md:p-8 space-y-5">
        <h2 className="text-base font-semibold">Custom Git connection</h2>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Git base URL</label>
          <input
            className="input-field w-full"
            value={gitBaseUrl}
            onChange={(e) => setGitBaseUrl(e.target.value)}
            placeholder="https://git.example.com"
            autoComplete="off"
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-medium text-foreground">Access token</label>
            <SecretHint set={data?.gitlab.groupAccessTokenSet ?? false} />
          </div>
          <input
            type="password"
            className="input-field w-full font-mono text-sm"
            value={accessTokenValue}
            onChange={(e) => setAccessTokenValue(e.target.value)}
            placeholder="token"
            autoComplete="new-password"
          />
          {data?.gitlab.groupAccessTokenSet && isCustomContext ? (
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

        <div className="flex justify-end">
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveCustom()}
            className="btn-primary inline-flex items-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Custom Git
          </button>
        </div>
      </div>
    </div>
  );
}
