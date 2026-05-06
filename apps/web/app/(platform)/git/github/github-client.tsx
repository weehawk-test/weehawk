"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { ExternalLink, GitBranch, Loader2, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useOrgWorkspace } from "@/(platform)/org-workspace/org-workspace-context";
import {
  fetchGitSettings,
  fetchPublicGithubAppManifest,
  updateGitSettings,
  deleteGitAccount,
  type GithubAppManifest,
  type GitSettingsPublic,
} from "@/lib/git-api";
import { GitBreadcrumb } from "../_components/git-breadcrumb";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const GITHUB_APP_REGISTER_ACTION = "https://github.com/settings/apps/new";

function postManifestToGithub(manifest: GithubAppManifest): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = GITHUB_APP_REGISTER_ACTION;
  form.target = "_self";

  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "manifest";
  input.value = JSON.stringify(manifest);
  form.appendChild(input);

  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
}

export function GitHubGitSettingsClient({
  initialData,
  organizationPublicId,
  hideBreadcrumb = false,
}: {
  initialData: GitSettingsPublic | null;
  organizationPublicId: string;
  hideBreadcrumb?: boolean;
}) {
  const { accessToken } = useAuth();
  const { toast } = useToast();
  const orgFromCtx = useOrgWorkspace().publicId;
  const orgPid = (organizationPublicId || orgFromCtx).trim();
  const [loading, setLoading] = useState(!initialData);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [disconnectBusy, setDisconnectBusy] = useState(false);
  const [switchBusy, setSwitchBusy] = useState(false);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);
  const [accountName, setAccountName] = useState("");
  const [data, setData] = useState<GitSettingsPublic | null>(initialData);

  const load = useCallback(async () => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const s = await fetchGitSettings(accessToken, orgPid);
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
  }, [accessToken, orgPid, toast]);

  useEffect(() => {
    if (!initialData) {
      void load();
    }
  }, [initialData, load]);

  const startGithubManifestRegistration = useCallback(async () => {
    if (!orgPid) {
      toast({
        title: "No active organization",
        description: "Select an organization workspace, then try again.",
        variant: "destructive",
      });
      return;
    }
    setRegisterBusy(true);
    try {
      if (accountName.trim() && accessToken) {
        await updateGitSettings(accessToken, orgPid, {
          accountName: accountName.trim(),
          createNewAccount: true,
        });
      }
      const manifest = await fetchPublicGithubAppManifest(orgPid);
      postManifestToGithub(manifest);
    } catch (e) {
      toast({
        title: "Could not start GitHub App registration",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      setRegisterBusy(false);
    }
  }, [accountName, accessToken, orgPid, toast]);

  const setActiveAccount = useCallback(async (accountPublicId: string) => {
    if (!accessToken) return;
    setSwitchBusy(true);
    try {
      const s = await updateGitSettings(accessToken, orgPid, {
        accountPublicId,
        githubAppSlug: data?.github.appSlug ?? undefined,
      });
      setData(s);
      toast({ title: "Active GitHub account changed" });
    } catch (e) {
      toast({
        title: "Could not switch account",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSwitchBusy(false);
    }
  }, [accessToken, data?.github.appSlug, orgPid, toast]);

  const removeAccount = useCallback(async (accountPublicId: string) => {
    if (!accessToken) return;
    setDeletingAccountId(accountPublicId);
    try {
      const s = await deleteGitAccount(accessToken, orgPid, accountPublicId);
      setData(s);
      toast({ title: "GitHub account removed" });
    } catch (e) {
      toast({
        title: "Could not remove account",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setDeletingAccountId(null);
    }
  }, [accessToken, orgPid, toast]);

  const disconnectGithub = useCallback(async () => {
    if (!accessToken) return;
    setDisconnectBusy(true);
    try {
      const s = await updateGitSettings(accessToken, orgPid, {
        githubAppId: "",
        githubClientId: "",
        githubAppSlug: "",
        githubClientSecret: "",
        githubPrivateKey: "",
        githubWebhookSecret: "",
      });
      setData(s);
      toast({
        title: "GitHub disconnected",
        description: "Saved credentials for this platform were removed.",
      });
    } catch (e) {
      toast({
        title: "Could not remove GitHub data",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setDisconnectBusy(false);
    }
  }, [accessToken, orgPid, toast]);

  if (loading && !data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  const connected =
    Boolean(data?.github.appId?.trim()) ||
    Boolean(data?.github.clientId?.trim()) ||
    Boolean(data?.github.clientSecretSet || data?.github.privateKeySet);

  const installUrl = data?.github.installAppUrl?.trim() || null;

  return (
    <div className="w-full space-y-8 pb-12">
      {!hideBreadcrumb ? <GitBreadcrumb current="github" /> : null}

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
            Step 1: create the GitHub App (manifest). Step 2: install it on your account or
            organization so Weehawk can list and clone repositories. You can remove stored
            credentials here at any time.
          </p>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-blue-500/25 bg-gradient-to-br from-blue-500/10 via-card/50 to-transparent p-6 md:p-8">
        <div className="absolute -right-20 -top-20 h-40 w-40 rounded-full bg-blue-400/20 blur-3xl pointer-events-none" />
        <div className="relative space-y-5">
          {data?.githubAccounts?.length ? (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">GitHub accounts</label>
              <select
                className="input-field w-full md:max-w-sm"
                value={data.github.activePublicId ?? ""}
                onChange={(e) => void setActiveAccount(e.target.value)}
                disabled={switchBusy}
              >
                {data.githubAccounts.map((a) => (
                  <option key={a.publicId} value={a.publicId}>
                    {a.name}{a.isActive ? " (active)" : ""}
                  </option>
                ))}
              </select>
              <div className="mt-2 space-y-2 md:max-w-md">
                {data.githubAccounts.map((a) => (
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
          <div className="space-y-1 md:max-w-sm">
            <label className="text-xs font-medium text-muted-foreground">
              New account name (optional)
            </label>
            <input
              className="input-field w-full"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder="Team GitHub App"
              autoComplete="off"
            />
          </div>
          <h2 className="text-lg font-semibold">1. Create GitHub App on GitHub</h2>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
            Sends your app settings to GitHub using the standard manifest POST. After you submit on
            GitHub, you return here and we store the app credentials.
          </p>
          <button
            type="button"
            disabled={registerBusy}
            onClick={() => void startGithubManifestRegistration()}
            className="btn-primary inline-flex items-center gap-2.5 !py-2.5 !px-5 w-fit disabled:opacity-60"
          >
            {registerBusy ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <GitBranch className="w-5 h-5" />
            )}
            Create GitHub App on GitHub
            <ExternalLink className="w-4 h-4 opacity-80" />
          </button>
        </div>
      </div>

      {connected && installUrl ? (
        <div className="relative overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 via-card/50 to-transparent p-6 md:p-8">
          <div className="relative space-y-4">
            <h2 className="text-lg font-semibold">2. Grant repository access (install)</h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
              Creating the app alone does not expose repositories. Install the app on your user or
              org and choose which repositories Weehawk may access. Then repository lists and
              deployments can use GitHub.
            </p>
            <a
              href={installUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary inline-flex items-center gap-2.5 !py-2.5 !px-5 w-fit"
            >
              Install GitHub App
              <ExternalLink className="w-4 h-4 opacity-80" />
            </a>
          </div>
        </div>
      ) : null}

      {connected && !installUrl ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-muted-foreground">
          <p className="font-medium text-amber-200/90">Install link unavailable</p>
          <p className="mt-1 leading-relaxed">
            We could not resolve your app slug yet. Open your app on GitHub → <em>Public page</em> →
            use <strong>Install</strong> there, or reload this page after a moment.
          </p>
        </div>
      ) : null}

      {data ? (
        <div className="glass-panel rounded-xl border border-white/10 px-4 py-3 text-sm space-y-3">
          <p className="text-muted-foreground">
            Status:{" "}
            <span className={connected ? "text-emerald-400/90 font-medium" : "text-muted-foreground"}>
              {connected ? "GitHub App credentials saved" : "Not connected yet"}
            </span>
            {data.github.appId ? (
              <span className="text-muted-foreground ml-2">· App ID {data.github.appId}</span>
            ) : null}
            {data.github.appSlug ? (
              <span className="text-muted-foreground ml-2">· {data.github.appSlug}</span>
            ) : null}
            {connected && data.updatedAt ? (
              <span className="block text-[11px] text-muted-foreground/80 mt-1">
                Last updated {new Date(data.updatedAt).toLocaleString()}
              </span>
            ) : null}
          </p>

          {connected && accessToken ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  disabled={disconnectBusy}
                  className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive hover:bg-destructive/15 disabled:opacity-50"
                >
                  {disconnectBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  Remove GitHub connection from Weehawk
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove GitHub credentials?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This deletes the GitHub App ID, client secret, private key, and webhook secret
                    stored in Weehawk. Your app on GitHub is not deleted; you can revoke or delete it
                    from GitHub settings if you want.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => void disconnectGithub()}
                  >
                    Remove stored data
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
