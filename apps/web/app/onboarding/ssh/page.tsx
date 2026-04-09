"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { OnboardingPageShell } from "@/components/onboarding/page-shell";
import { RegisterRemoteServerOnboarding } from "@/components/onboarding/register-remote-server-onboarding";
import { writeServerDeployChoice } from "@/lib/server-deploy-preference";

export default function OnboardingSshPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    setToken("desktop-local-session");
  }, [router]);

  const finishAndEnter = useCallback(() => {
    router.replace("/");
  }, [router]);

  const skipDeploySetupAndEnterApp = useCallback(() => {
    writeServerDeployChoice("later");
    finishAndEnter();
  }, [finishAndEnter]);

  if (!token) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <OnboardingPageShell wide subtitle="Step 2 of 2 — SSH connection">
      <p className="text-sm text-muted-foreground text-center mb-2">
        <Link
          href="/onboarding/server"
          className="text-primary hover:underline underline-offset-4"
        >
          Back to step 1
        </Link>
      </p>
      <RegisterRemoteServerOnboarding accessToken={token} />
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
