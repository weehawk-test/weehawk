"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { OnboardingPageShell } from "@/components/onboarding/page-shell";
import { RegisterRemoteServerOnboarding } from "@/components/onboarding/register-remote-server-onboarding";
import { writeServerDeployChoice } from "@/lib/server-deploy-preference";
import { writeSelfHostedFirstInstallState } from "@/lib/self-hosted-first-install";
import { useAuth } from "@/contexts/auth-context";
import { Loader2 } from "lucide-react";

function isSelfHostedInstance(): boolean {
  return (process.env.NEXT_PUBLIC_INSTANCE_MODE ?? "cloud").trim().toLowerCase() === "self-hosted";
}

export default function OnboardingSshPage() {
  const router = useRouter();
  const { accessToken, isReady } = useAuth();
  const selfHosted = isSelfHostedInstance();

  useEffect(() => {
    if (isReady && !accessToken) router.replace("/login");
  }, [isReady, accessToken, router]);

  const finishAndEnter = () => {
    router.replace("/");
  };

  const skipDeploySetupAndEnterApp = () => {
    writeServerDeployChoice("later");
    if (selfHosted) writeSelfHostedFirstInstallState("done");
    finishAndEnter();
  };

  if (!isReady || !accessToken) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <OnboardingPageShell
      wide
      cozy={selfHosted}
      subtitle={selfHosted ? "Step 2 of 3 — SSH connection" : "Step 2 of 2 — SSH connection"}
    >
      <p className="text-sm text-muted-foreground text-center mb-2">
        <Link
          href={selfHosted ? "/onboarding/self-hosted-deploy" : "/onboarding/server"}
          className="text-primary hover:underline underline-offset-4"
        >
          Back to step 1
        </Link>
      </p>
      <RegisterRemoteServerOnboarding
        accessToken={accessToken}
        onSaved={() => {
          if (selfHosted) writeSelfHostedFirstInstallState("done");
        }}
      />
      <div className="flex flex-col items-center gap-1 border-t border-white/10 pt-4 mt-4">
        <button
          type="button"
          className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          onClick={skipDeploySetupAndEnterApp}
        >
          Set up later
        </button>
      </div>
    </OnboardingPageShell>
  );
}
