"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { ExternalLink, GitBranch, Loader2, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import {
  fetchGitSettings,
  fetchPublicGithubAppManifest,
  updateGitSettings,
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

export function GitHubGitSettingsClient({ initialData }: { initialData: GitSettingsPublic | null }) {
  const { accessToken } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(!initialData);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [disconnectBusy, setDisconnectBusy] = useState(false);
  const [data, setData] = useState<GitSettingsPublic | null>(initialData);

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
    if (!initialData) {
      void load();
    }
  }, [initialData, load]);

  const startGithubManifestRegistration = useCallback(async () => {
    setRegisterBusy(true);
    try {
      const manifest = await fetchPublicGithubAppManifest();
      postManifestToGithub(manifest);
    } catch (e) {
      toast({
        title: "Could not start GitHub App registration",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      setRegisterBusy(false);
    }
  }, [toast]);

  const disconnectGithub = useCallback(async () => {
    if (!accessToken) return;
    setDisconnectBusy(true);
    try {
      const s = await updateGitSettings(accessToken, {
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
  }, [accessToken, toast]);

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
            Step 1: create the GitHub App (manifest). Step 2: install it on your account or
            organization so Weehawk can list and clone repositories. You can remove stored
            credentials here at any time.
          </p>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-blue-500/25 bg-gradient-to-br from-blue-500/10 via-card/50 to-transparent p-6 md:p-8">
        <div className="absolute -right-20 -top-20 h-40 w-40 rounded-full bg-blue-400/20 blur-3xl pointer-events-none" />
        <div className="relative space-y-5">
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
