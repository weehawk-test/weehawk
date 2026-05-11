"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { OnboardingPageShell } from "@/components/onboarding/page-shell";
import { ServerDeployChoiceSection } from "@/components/onboarding/server-deploy-choice-section";
import type { ServerDeployTarget } from "@/lib/server-deploy-preference";
import { writeServerDeployChoice } from "@/lib/server-deploy-preference";

export default function OnboardingServerPage() {
  const router = useRouter();
  const [gateOk, setGateOk] = useState(false);
  const [deployTarget, setDeployTarget] = useState<ServerDeployTarget>("localhost");

  useEffect(() => {
    setGateOk(true);
  }, []);

  useEffect(() => {
    if (!gateOk) return;
    setDeployTarget("localhost");
    writeServerDeployChoice("localhost");
  }, [gateOk]);

  const finishAndEnter = useCallback(() => {
    router.replace("/");
  }, [router]);

  const skipDeploySetupAndEnterApp = useCallback(() => {
    writeServerDeployChoice("later");
    finishAndEnter();
  }, [finishAndEnter]);

  if (!gateOk) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3 px-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <OnboardingPageShell wide subtitle="Step 1 of 2 — Choose where your workloads will run.">
      <ServerDeployChoiceSection
        value={deployTarget}
        onChange={setDeployTarget}
        onSetupLater={skipDeploySetupAndEnterApp}
        onRemoteSshSetup={() => router.push("/onboarding/ssh")}
      />
    </OnboardingPageShell>
  );
}
