"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { Loader2, Save } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useOrgWorkspace } from "@/(platform)/org-workspace/org-workspace-context";
import { orgScopedQuerySegment } from "@/lib/react-query-scope";
import {
  fetchGitSettings,
  updateGitSettings,
  deleteGitAccount,
  type GitSettingsPublic,
  type UpdateGitSettingsPayload,
} from "@/lib/git-api";
import { SecretHint } from "../_components/secret-hint";
import { GitBreadcrumb } from "../_components/git-breadcrumb";

const gitSettingsPredicate = (orgPid: string) => (q: { queryKey: unknown }) =>
  Array.isArray(q.queryKey) &&
  q.queryKey[0] === "git-settings" &&
  q.queryKey[1] === orgScopedQuerySegment(orgPid);

export function GitLabGitSettingsClient({
  initialData,
  organizationPublicId,
  hideBreadcrumb = false,
}: {
  initialData: GitSettingsPublic | null;
  organizationPublicId: string;
  hideBreadcrumb?: boolean;
}) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const orgFromCtx = useOrgWorkspace().publicId;
  const orgPid = (organizationPublicId || orgFromCtx).trim();
  const [saving, setSaving] = useState(false);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);
  const [gitlabBaseUrlTouched, setGitlabBaseUrlTouched] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [gitlabBaseUrl, setGitlabBaseUrl] = useState(
    () => initialData?.gitlab.baseUrl ?? "https://gitlab.com",
  );
  const [gitlabGroupAccessToken, setGitlabGroupAccessToken] = useState("");

  const gitQ = useQuery({
    queryKey: ["git-settings", orgScopedQuerySegment(orgPid)],
    queryFn: () => fetchGitSettings(accessToken!, orgPid),
    enabled: Boolean(accessToken && orgPid),
    initialData: initialData ?? undefined,
  });

  const data = gitQ.data ?? null;

  useEffect(() => {
    if (!data || gitlabBaseUrlTouched) return;
    setGitlabBaseUrl(data.gitlab.baseUrl ?? "https://gitlab.com");
  }, [data, data?.gitlab.baseUrl, data?.updatedAt, gitlabBaseUrlTouched]);

  const saveGitlab = async () => {
    if (!accessToken) return;
    setSaving(true);
    try {
      const payload: UpdateGitSettingsPayload = {
        gitlabBaseUrl: gitlabBaseUrl.trim() || "https://gitlab.com",
        ...(accountName.trim() ? { accountName: accountName.trim(), createNewAccount: true } : {}),
      };
      if (gitlabGroupAccessToken.trim())
        payload.gitlabGroupAccessToken = gitlabGroupAccessToken.trim();
      const next = await updateGitSettings(accessToken, orgPid, payload);
      queryClient.setQueryData(["git-settings", orgScopedQuerySegment(orgPid)], next);
      setGitlabGroupAccessToken("");
      setAccountName("");
      setGitlabBaseUrlTouched(false);
      void queryClient.invalidateQueries({
        predicate: gitSettingsPredicate(orgPid),
      });
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

  const removeAccount = async (accountPublicId: string) => {
    if (!accessToken) return;
    setDeletingAccountId(accountPublicId);
    try {
      const next = await deleteGitAccount(accessToken, orgPid, accountPublicId);
      queryClient.setQueryData(["git-settings", orgScopedQuerySegment(orgPid)], next);
      setGitlabBaseUrl(next.gitlab.baseUrl ?? "https://gitlab.com");
      setGitlabBaseUrlTouched(false);
      toast({ title: "GitLab account removed" });
    } catch (e) {
      toast({
        title: "Could not remove account",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setDeletingAccountId(null);
    }
  };

  const setActiveAccount = async (accountPublicId: string) => {
    if (!accessToken) return;
    setSaving(true);
    try {
      const next = await updateGitSettings(accessToken, orgPid, { accountPublicId });
      queryClient.setQueryData(["git-settings", orgScopedQuerySegment(orgPid)], next);
      setGitlabBaseUrl(next.gitlab.baseUrl ?? "https://gitlab.com");
      setGitlabBaseUrlTouched(false);
      toast({ title: "Active GitLab account changed" });
    } catch (e) {
      toast({
        title: "Could not switch account",
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
      const next = await updateGitSettings(accessToken, orgPid, {
        [field]: "",
      } as UpdateGitSettingsPayload);
      queryClient.setQueryData(["git-settings", orgScopedQuerySegment(orgPid)], next);
      void queryClient.invalidateQueries({
        predicate: gitSettingsPredicate(orgPid),
      });
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

  if (gitQ.isPending && !gitQ.data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (gitQ.isError && !data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-destructive text-sm px-4 text-center">
        {gitQ.error instanceof Error ? gitQ.error.message : String(gitQ.error)}
      </div>
    );
  }

  return (
    <div className="w-full space-y-8 pb-12">
      {!hideBreadcrumb ? <GitBreadcrumb current="gitlab" /> : null}

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
        {data?.gitlabAccounts?.length ? (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">GitLab accounts</label>
            <select
              className="input-field w-full"
              value={data.gitlab.activePublicId ?? ""}
              onChange={(e) => void setActiveAccount(e.target.value)}
              disabled={saving}
            >
              {data.gitlabAccounts.map((a) => (
                <option key={a.publicId} value={a.publicId}>
                  {a.name}{a.isActive ? " (active)" : ""}
                </option>
              ))}
            </select>
            <div className="mt-2 space-y-2">
              {data.gitlabAccounts.map((a) => (
                <div key={a.publicId} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                  <div className="text-sm">
                    <span className="font-medium">{a.name}</span>
                    {a.isActive ? <span className="ml-2 text-xs text-emerald-400">active</span> : null}
                  </div>
                  {!a.isActive ? (
                    <button
                      type="button"
                      className="text-xs text-destructive hover:underline disabled:opacity-50"
                      disabled={deletingAccountId === a.publicId}
                      onClick={() => void removeAccount(a.publicId)}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground leading-relaxed -mt-2">
          This token is sent as <code className="text-[10px]">PRIVATE-TOKEN</code> to GitLab&apos;s API and used for authenticated <code className="text-[10px]">git clone</code> when needed.
        </p>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">New account name (optional)</label>
          <input
            className="input-field w-full"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder="Prod GitLab token"
            autoComplete="off"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">GitLab base URL</label>
          <input
            className="input-field w-full"
            value={gitlabBaseUrl}
            onChange={(e) => {
              setGitlabBaseUrlTouched(true);
              setGitlabBaseUrl(e.target.value);
            }}
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

        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveGitlab()}
            className="btn-primary order-1 inline-flex w-full items-center justify-center gap-2 sm:order-2 sm:w-auto"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save GitLab
          </button>
          {data?.gitlab.groupAccessTokenSet && data.updatedAt ? (
            <p className="order-2 text-[11px] text-muted-foreground sm:order-1">
              Last updated {new Date(data.updatedAt).toLocaleString()}
            </p>
          ) : (
            <span className="order-2 hidden sm:block sm:order-1" />
          )}
        </div>
      </div>
    </div>
  );
}
