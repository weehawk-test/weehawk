"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { OnboardingPageShell } from "@/components/onboarding/page-shell";
import { RemoteServerInstallBlock } from "@/components/remote-server/remote-server-install-block";
import { useAuth } from "@/contexts/auth-context";
import { fetchRemoteServers } from "@/lib/remote-servers-api";
import { getActiveOrganizationPublicId } from "@/lib/organizations-api";
import {
  readSelfHostedFirstInstallState,
  writeSelfHostedFirstInstallState,
} from "@/lib/self-hosted-first-install";

function isSelfHostedInstance(): boolean {
  return (process.env.NEXT_PUBLIC_INSTANCE_MODE ?? "cloud").trim().toLowerCase() === "self-hosted";
}

export default function SelfHostedInstallOnboardingPage() {
  const router = useRouter();
  const params = useSearchParams();
  const serverId = params.get("serverId") ?? "";
  const { accessToken, isReady, user } = useAuth();

  const [orgPublicId, setOrgPublicId] = useState("");

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
    }
  }, [isReady, user, router]);

  useEffect(() => {
    let cancelled = false;
    getActiveOrganizationPublicId()
      .then((id) => {
        if (!cancelled && id) setOrgPublicId(id);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const serversQ = useQuery({
    queryKey: ["remote-servers", orgPublicId],
    queryFn: () => fetchRemoteServers(accessToken ?? ""),
    enabled: Boolean(accessToken),
  });

  const targetServer = useMemo(() => {
    if (!serversQ.data) return null;
    if (serverId) {
      return (
        serversQ.data.find(
          (s) => s.publicId === serverId || String(s.id) === serverId,
        ) ?? serversQ.data[serversQ.data.length - 1] ?? null
      );
    }
    return serversQ.data[serversQ.data.length - 1] ?? null;
  }, [serversQ.data, serverId]);

  const finishAndEnter = () => {
    writeSelfHostedFirstInstallState("done");
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
    <OnboardingPageShell wide cozy subtitle="Step 3 of 3 — Install & maintenance">
      <p className="text-xs sm:text-sm text-muted-foreground text-center mb-3">
        <Link
          href="/onboarding/self-hosted-deploy"
          className="text-primary hover:underline underline-offset-4"
        >
          Back to step 1
        </Link>
      </p>

      {serversQ.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading servers…
        </div>
      ) : targetServer ? (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 sm:px-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
              {targetServer.name}
            </p>
            <p className="text-[13px] sm:text-sm text-muted-foreground mt-1">
              <span className="font-mono text-xs text-foreground/90">
                {targetServer.sshUser}@{targetServer.host}
              </span>{" "}
              — Run the install script to provision Docker, Swarm, and Traefik on this server.
            </p>
          </div>
          <RemoteServerInstallBlock
            accessToken={accessToken}
            row={targetServer}
            installMaintenanceAllowed
            activeOrgPublicIdForProvision={orgPublicId}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-8">
          No server found. Go back and add a server first.
        </p>
      )}

      <div className="flex flex-col items-center gap-1 border-t border-white/10 pt-3.5 mt-3">
        <button
          type="button"
          className="text-xs sm:text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          onClick={finishAndEnter}
        >
          Set up later
        </button>
      </div>
    </OnboardingPageShell>
  );
}
