"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { OnboardingPageShell } from "@/components/onboarding/page-shell";
import { SelfHostedDeployInstallSection } from "@/components/onboarding/self-hosted-deploy-install-section";
import { useAuth } from "@/contexts/auth-context";
import { readSelfHostedFirstInstallState } from "@/lib/self-hosted-first-install";

function isSelfHostedInstance(): boolean {
  return (process.env.NEXT_PUBLIC_INSTANCE_MODE ?? "cloud").trim().toLowerCase() === "self-hosted";
}

export default function SelfHostedDeployOnboardingPage() {
  const router = useRouter();
  const { accessToken, isReady, user } = useAuth();

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
    if (user.role !== "ADMIN") {
      router.replace("/");
      return;
    }
    if (readSelfHostedFirstInstallState() !== "pending") {
      router.replace("/");
    }
  }, [isReady, user, router]);

  const finishAndEnter = () => {
    router.replace("/");
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
    <OnboardingPageShell wide cozy subtitle="Step 1 of 3 — Choose where deployments will run">
      <SelfHostedDeployInstallSection onSetupLater={finishAndEnter} />
    </OnboardingPageShell>
  );
}
