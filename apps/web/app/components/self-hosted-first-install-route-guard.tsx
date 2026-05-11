"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { readSelfHostedFirstInstallState } from "@/lib/self-hosted-first-install";

function isSelfHostedInstance(): boolean {
  return (process.env.NEXT_PUBLIC_INSTANCE_MODE ?? "cloud").trim().toLowerCase() === "self-hosted";
}

export function SelfHostedFirstInstallRouteGuard() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const { user, isReady } = useAuth();

  useEffect(() => {
    if (!isSelfHostedInstance() || !isReady || !user) return;
    if (readSelfHostedFirstInstallState() !== "pending") return;
    if (pathname.startsWith("/onboarding")) return;
    if (pathname.startsWith("/organizations")) return;
    if (
      pathname.startsWith("/login") ||
      pathname.startsWith("/register") ||
      pathname.startsWith("/forgot-password") ||
      pathname.startsWith("/reset-password") ||
      pathname.startsWith("/auth/")
    ) {
      return;
    }
    router.replace("/onboarding/self-hosted-deploy");
  }, [isReady, user, pathname, router]);

  return null;
}
