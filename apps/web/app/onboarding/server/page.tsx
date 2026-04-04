"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { ServerDeployChoiceSection } from "@/components/auth/server-deploy-choice-section";
import { useAuth } from "@/contexts/auth-context";
import { fetchSetupStatus } from "@/lib/auth-api";
import {
  clearAllOnboardingSession,
  isOauthCloudOnboardingPending,
  readPendingOnboardingAuth,
} from "@/lib/pending-onboarding-auth";
import type { ServerDeployTarget } from "@/lib/server-deploy-preference";
import { writeServerDeployChoice } from "@/lib/server-deploy-preference";

export default function OnboardingServerPage() {
  const router = useRouter();
  const { accessToken, isReady, setSession } = useAuth();
  const [gateOk, setGateOk] = useState(false);
  const [deployTarget, setDeployTarget] = useState<ServerDeployTarget>("localhost");

  const setupQuery = useQuery({
    queryKey: ["auth", "setup-status"],
    queryFn: fetchSetupStatus,
    staleTime: 0,
    gcTime: 0,
  });

  useEffect(() => {
    if (!isReady) return;
    const pending = readPendingOnboardingAuth();
    const oauthOnboarding = isOauthCloudOnboardingPending();
    const allowEmail = Boolean(pending) && !accessToken;
    const allowOauth = oauthOnboarding && Boolean(accessToken);
    if (!allowEmail && !allowOauth) {
      router.replace("/");
      return;
    }
    setGateOk(true);
  }, [isReady, accessToken, router]);

  const edition = setupQuery.data?.edition ?? "selfhosted";
  const isCloud = edition === "cloud";

  useEffect(() => {
    if (!gateOk) return;
    if (isCloud) {
      setDeployTarget("remote");
      writeServerDeployChoice("remote");
    } else {
      setDeployTarget("localhost");
      writeServerDeployChoice("localhost");
    }
  }, [gateOk, isCloud]);

  const finishAndEnter = useCallback(() => {
    const pending = readPendingOnboardingAuth();
    if (pending) {
      setSession(pending);
    }
    clearAllOnboardingSession();
    router.replace("/");
  }, [router, setSession]);

  const skipDeploySetupAndEnterApp = useCallback(() => {
    writeServerDeployChoice("later");
    finishAndEnter();
  }, [finishAndEnter]);

  if (!isReady || !gateOk || setupQuery.isPending || setupQuery.isError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3 px-4">
        {setupQuery.isError ? (
          <p className="text-sm text-destructive text-center max-w-md">Could not load setup status.</p>
        ) : (
          <>
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading…</p>
          </>
        )}
      </div>
    );
  }

  return (
    <AuthPageShell wide subtitle="Step 1 of 2 — Choose where your workloads will run.">
      <ServerDeployChoiceSection
        variant={isCloud ? "cloud" : "selfhosted"}
        value={deployTarget}
        onChange={setDeployTarget}
        onSetupLater={skipDeploySetupAndEnterApp}
        onRemoteSshSetup={isCloud ? () => router.push("/onboarding/ssh") : undefined}
      />
    </AuthPageShell>
  );
}
