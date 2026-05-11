"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { Loader2, PlugZap } from "lucide-react";
import { OnboardingPageShell } from "@/components/onboarding/page-shell";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { restoreSelfHostedLocalHostApi } from "@/lib/remote-servers-api";
import { SELF_HOSTED_BOOTSTRAP_SSH_HOST } from "@/lib/loopback-ssh-host";
import {
  readSelfHostedFirstInstallState,
  writeSelfHostedFirstInstallState,
} from "@/lib/self-hosted-first-install";
import { getActiveOrganizationPublicId } from "@/lib/organizations-api";

function isSelfHostedInstance(): boolean {
  return (process.env.NEXT_PUBLIC_INSTANCE_MODE ?? "cloud").trim().toLowerCase() === "self-hosted";
}

export default function SelfHostedThisMachineOnboardingPage() {
  const router = useRouter();
  const { accessToken, isReady, user } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (!isSelfHostedInstance()) {
      router.replace("/");
    }
  }, [router]);

  useEffect(() => {
    if (isReady && !accessToken) router.replace("/login");
  }, [isReady, accessToken, router]);

  useEffect(() => {
    if (!isReady || !user) return;
    if (user.role !== "ADMIN" || readSelfHostedFirstInstallState() !== "pending") {
      router.replace("/");
    }
  }, [isReady, user, router]);

  const [acmeEmail, setAcmeEmail] = useState("");
  const canAdd = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(acmeEmail.trim());

  const restoreMut = useMutation({
    mutationFn: async () => {
      const orgId = (await getActiveOrganizationPublicId().catch(() => null))?.trim() || null;
      return restoreSelfHostedLocalHostApi(accessToken ?? "", orgId, acmeEmail.trim());
    },
    onSuccess: (result) => {
      const sshTarget = `${result.remoteServer.sshUser}@${result.remoteServer.host}`;
      if (result.alreadyPresent) {
        toast({
          title: "This Server already listed",
          description: `This Server (${sshTarget}) is already in Remote servers.`,
        });
      } else {
        toast({
          title: "Local deploy host added",
          description: `This Server (${sshTarget}) is ready for deployments.`,
        });
      }
      writeSelfHostedFirstInstallState("done");
      router.replace("/");
    },
    onError: (err) => {
      toast({
        title: "Could not add This Server",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  if (!isReady || !accessToken) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <OnboardingPageShell wide cozy subtitle="Step 2 of 3 — Confirm local deploy host">
      <p className="text-xs sm:text-sm text-muted-foreground text-center mb-3">
        <Link
          href="/onboarding/self-hosted-deploy"
          className="text-primary hover:underline underline-offset-4"
        >
          Back to step 1
        </Link>
      </p>

      <div className="space-y-3.5 rounded-xl border border-border bg-white/[0.02] p-3.5 sm:p-4 text-left">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">This machine</p>
          <p className="text-[13px] sm:text-sm text-muted-foreground mt-1.5 leading-relaxed">
            Weehawk will add the default deploy host <span className="font-medium text-foreground">This Server</span>{" "}
            using SSH target{" "}
            <span className="font-mono text-xs text-foreground/90">
              root@{SELF_HOSTED_BOOTSTRAP_SSH_HOST}
            </span>
            . This matches the Remote servers screen after install.
          </p>
        </div>

        <label className="space-y-1 block">
          <span className="text-xs text-muted-foreground">
            Certificate email (For Let&apos;s Encrypt notices)
          </span>
          <input
            type="email"
            value={acmeEmail}
            onChange={(e) => setAcmeEmail(e.target.value)}
            className="w-full rounded-lg border border-border bg-muted dark:bg-black/40 px-3 py-2 text-sm"
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </label>

        <button
          type="button"
          disabled={restoreMut.isPending || !canAdd}
          onClick={() => restoreMut.mutate()}
          className="btn-primary inline-flex w-full min-h-10 sm:min-h-11 items-center justify-center gap-2 text-xs sm:text-sm disabled:opacity-50"
        >
          {restoreMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
          Add This Server
        </button>
      </div>

      <div className="flex flex-col items-center gap-1 border-t border-white/10 pt-3.5 mt-3">
        <button
          type="button"
          className="text-xs sm:text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          onClick={() => {
            writeSelfHostedFirstInstallState("done");
            router.replace("/");
          }}
        >
          Set up later
        </button>
      </div>
    </OnboardingPageShell>
  );
}
