"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Clock3, ExternalLink, GitBranch, Search, Trash2, X } from "lucide-react";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import {
  createGitAccount,
  deleteGitAccount,
  fetchGitSettings,
  fetchPublicGithubAppManifest,
  type GitSettingsPublic,
} from "@/lib/git-api";
import {
  ORG_DATA_CHANGED_EVENT,
  type OrgDataChangedDetail,
} from "@/lib/org-realtime-events";

type Provider = "github" | "gitlab";

function formatShortDate(input: string | null): string {
  if (!input) return "—";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function GitPageClient({
  initialSettings,
  organizationPublicId,
  initialQuery = "",
}: {
  initialSettings: GitSettingsPublic | null;
  organizationPublicId: string;
  initialQuery?: string;
}) {
  const { accessToken } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [settings, setSettings] = useState<GitSettingsPublic | null>(initialSettings);
  const [q, setQ] = useState(initialQuery);
  const [openProvider, setOpenProvider] = useState<Provider | null>(null);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [gitlabSaving, setGitlabSaving] = useState(false);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);
  const [isOrganization, setIsOrganization] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [gitlabAccountName, setGitlabAccountName] = useState("");
  const [gitlabToken, setGitlabToken] = useState("");

  const githubAccounts = settings?.githubAccounts ?? [];
  const gitlabAccounts = settings?.gitlabAccounts ?? [];
  const githubInstallUrl = settings?.github.installAppUrl?.trim() || "";
  const allAccounts = [
    ...githubAccounts.map((a) => ({ ...a, provider: "github" as const })),
    ...gitlabAccounts.map((a) => ({ ...a, provider: "gitlab" as const })),
  ];
  const query = q.trim().toLowerCase();
  const filteredAccounts = useMemo(
    () =>
      query
        ? allAccounts.filter(
            (acc) =>
              acc.name.toLowerCase().includes(query) ||
              acc.provider.toLowerCase().includes(query),
          )
        : allAccounts,
    [allAccounts, query],
  );

  useEffect(() => {
    if (!accessToken || !organizationPublicId) return;
    let cancelled = false;
    const refreshSettings = async () => {
      try {
        const next = await fetchGitSettings(accessToken, organizationPublicId);
        if (!cancelled) setSettings(next);
      } catch {
        // Keep current view; user-facing actions already show explicit toasts.
      }
    };
    const onOrgDataChanged = (event: Event) => {
      const detail = (event as CustomEvent<OrgDataChangedDetail>).detail;
      if (detail?.entity && detail.entity !== "git_settings") return;
      void refreshSettings();
    };
    window.addEventListener(ORG_DATA_CHANGED_EVENT, onOrgDataChanged as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener(ORG_DATA_CHANGED_EVENT, onOrgDataChanged as EventListener);
    };
  }, [accessToken, organizationPublicId]);

  const startGithubManifestRegistration = async () => {
    if (!organizationPublicId) return;
    setRegisterBusy(true);
    try {
      const orgSlug = orgName.trim().replace(/^@+/, "");
      if (isOrganization && !orgSlug) {
        toast({
          title: "Organization name is required",
          description: "Enter your GitHub organization handle to continue.",
          variant: "destructive",
        });
        setRegisterBusy(false);
        return;
      }
      if (isOrganization && orgName.trim() && accessToken) {
        await createGitAccount(accessToken, organizationPublicId, {
          provider: "github",
          accountName: orgSlug,
        });
      }
      const manifest = await fetchPublicGithubAppManifest(organizationPublicId);
      const form = document.createElement("form");
      form.method = "POST";
      form.action =
        isOrganization && orgSlug
          ? `https://github.com/organizations/${encodeURIComponent(orgSlug)}/settings/apps/new`
          : "https://github.com/settings/apps/new";
      form.target = "_self";
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "manifest";
      input.value = JSON.stringify(manifest);
      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();
      document.body.removeChild(form);
    } catch (e) {
      toast({
        title: "Could not start GitHub App setup",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      setRegisterBusy(false);
    }
  };

  const saveGitlabSettings = async () => {
    if (!accessToken || !organizationPublicId) return;
    if (!gitlabAccountName.trim()) {
      toast({
        title: "Account name is required",
        description: "Enter a name for this GitLab account before saving.",
        variant: "destructive",
      });
      return;
    }
    setGitlabSaving(true);
    try {
      const next = await createGitAccount(accessToken, organizationPublicId, {
        provider: "gitlab",
        accountName: gitlabAccountName.trim(),
        gitlabBaseUrl: "https://gitlab.com",
        ...(gitlabToken.trim() ? { gitlabGroupAccessToken: gitlabToken.trim() } : {}),
      });
      setGitlabToken("");
      setGitlabAccountName("");
      setSettings(next);
      toast({ title: "GitLab settings saved" });
      setOpenProvider(null);
    } catch (e) {
      toast({
        title: "Could not save GitLab settings",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setGitlabSaving(false);
    }
  };

  const removeAccount = async (accountPublicId: string) => {
    if (!accessToken || !organizationPublicId) return;
    const ok = await confirm({
      title: "Delete channel?",
      description: "This git account will be removed.",
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingAccountId(accountPublicId);
    try {
      const next = await deleteGitAccount(accessToken, organizationPublicId, accountPublicId);
      setSettings(next);
      toast({ title: "Git account removed" });
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


  return (
    <div className="w-full pb-10">
      <header className="mb-5 md:mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">Git</h1>
        <p className="mt-3 text-muted-foreground leading-relaxed">
          Choose where Weehawk stores credentials for pulling application source.
          <br />
          GitHub uses a GitHub App (create app, then install to grant repo access). GitLab uses an
          access token.
        </p>
      </header>

      <div className="mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search accounts..."
            className="input-field !pl-10 w-full bg-card/50"
          />
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-card/50">
        <p className="mb-2 text-sm font-medium text-slate-800 dark:text-foreground">Available Providers</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setOpenProvider("github")}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            <Image
              src="/deployment-sources/github.svg"
              alt=""
              width={14}
              height={14}
              className="h-3.5 w-3.5 invert"
            />
            Github
          </button>
          <button
            type="button"
            onClick={() => setOpenProvider("gitlab")}
            className="inline-flex items-center gap-2 rounded-md border border-violet-400/20 bg-violet-600/80 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
          >
            <Image
              src="/deployment-sources/gitlab.svg"
              alt=""
              width={14}
              height={14}
              className="h-3.5 w-3.5"
            />
            GitLab
          </button>
        </div>
      </div>

      {filteredAccounts.length > 0 ? (
        <div className="space-y-2">
          {filteredAccounts.map((acc) => (
            <div
              key={acc.publicId}
              className="group flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-card/50"
            >
              <div className="min-w-0 flex items-center gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 bg-slate-900 dark:border-white/10 dark:bg-zinc-900">
                  {acc.provider === "github" ? (
                    <Image
                      src="/deployment-sources/github.svg"
                      alt=""
                      width={14}
                      height={14}
                      className="h-3.5 w-3.5 invert"
                    />
                  ) : (
                    <Image
                      src="/deployment-sources/gitlab.svg"
                      alt=""
                      width={14}
                      height={14}
                      className="h-3.5 w-3.5"
                    />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-zinc-100">{acc.name}</p>
                  <p className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-muted-foreground">
                    <Clock3 className="h-3 w-3" />
                    {formatShortDate(acc.createdAt)}
                  </p>
                </div>
              </div>
              <div className="ml-3 flex items-center gap-2">
                {acc.provider === "github" && githubInstallUrl ? (
                  <a
                    href={githubInstallUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-primary opacity-0 transition-opacity group-hover:opacity-100 hover:bg-primary/10"
                    title="Install GitHub App"
                  >
                    Fallback
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => void removeAccount(acc.publicId)}
                  disabled={deletingAccountId === acc.publicId}
                  className="inline-flex items-center rounded-md p-1.5 text-destructive/80 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  title="Remove account"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex min-h-[240px] flex-col items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-center dark:border-white/10 dark:bg-card/50">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 dark:bg-white/5">
            <GitBranch className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-bold mb-2 text-slate-900 dark:text-foreground">
            {allAccounts.length > 0 ? "No matching accounts" : "No git accounts yet"}
          </h3>
          <p className="max-w-md text-muted-foreground">
            {allAccounts.length > 0
              ? "Try another search term."
              : "Connect GitHub or GitLab to start using repository-based deployments."}
          </p>
        </div>
      )}

      {openProvider ? (
        <div className="fixed inset-0 z-[90] modal-scrim flex items-center justify-center p-4" onClick={() => setOpenProvider(null)}>
          {openProvider === "github" ? (
            <div
              className="w-full max-w-2xl rounded-2xl border border-white/10 bg-background p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-2 flex items-start justify-between">
                <h2 className="text-3 font-semibold inline-flex items-center gap-2">
                  Github Provider
                  <Image
                    src="/deployment-sources/github.svg"
                    alt=""
                    width={16}
                    height={16}
                    className="h-4 w-4 dark:invert"
                  />
                </h2>
                <button
                  type="button"
                  onClick={() => setOpenProvider(null)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mb-4 text-sm text-muted-foreground max-w-2xl">
                Connect GitHub to our services by creating and installing a GitHub App. Setup is
                fast and usually takes just a few minutes.
              </p>
              <div className="mb-3 flex items-center gap-3">
                <label className="text-sm font-medium">Organization?</label>
                <button
                  type="button"
                  onClick={() => setIsOrganization((v) => !v)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isOrganization ? "bg-primary" : "bg-muted"}`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${isOrganization ? "translate-x-5" : "translate-x-1"}`}
                  />
                </button>
              </div>
              {isOrganization ? (
                <input
                  className="input-field mb-4 w-full"
                  placeholder="GitHub organization handle (e.g. weehawk)"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                />
              ) : null}
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => void startGithubManifestRegistration()}
                  disabled={registerBusy}
                  className="btn-primary text-sm disabled:opacity-50"
                >
                  {registerBusy ? "Starting..." : "Create GitHub App"}
                </button>
              </div>
            </div>
          ) : (
            <div
              className="w-full max-w-2xl rounded-2xl border border-white/10 bg-background p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-2 flex items-start justify-between">
                <h2 className="text-3 font-semibold inline-flex items-center gap-2">
                  GitLab Provider
                  <Image
                    src="/deployment-sources/gitlab.svg"
                    alt=""
                    width={16}
                    height={16}
                    className="h-4 w-4"
                  />
                </h2>
                <button
                  type="button"
                  onClick={() => setOpenProvider(null)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mb-4 text-sm text-muted-foreground max-w-2xl">
                Connect your GitLab account using a personal/group access token to allow repository
                listing and cloning.
              </p>
              <div className="space-y-3">
                <input
                  className="input-field w-full"
                  placeholder="Account name"
                  value={gitlabAccountName}
                  onChange={(e) => setGitlabAccountName(e.target.value)}
                />
                <input
                  type="password"
                  className="input-field w-full"
                  placeholder="Personal / Group access token"
                  value={gitlabToken}
                  onChange={(e) => setGitlabToken(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div className="mt-4 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => void saveGitlabSettings()}
                  disabled={gitlabSaving || !gitlabAccountName.trim()}
                  className="btn-primary text-sm disabled:opacity-50"
                >
                  {gitlabSaving ? "Saving..." : "Save GitLab"}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

