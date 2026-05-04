"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  acceptOrganizationInvite,
  notifyOrganizationsListChanged,
} from "@/lib/organizations-api";
import { useAuth } from "@/contexts/auth-context";

type State = "loading" | "success" | "error" | "need_sign_in";

function loginUrlWithNext(nextPath: string): string {
  const params = new URLSearchParams({ next: nextPath });
  return `/login?${params.toString()}`;
}

export default function AcceptOrgInvitePage() {
  const searchParams = useSearchParams();
  const { accessToken, isReady } = useAuth();
  const token = useMemo(() => searchParams.get("token")?.trim() ?? "", [searchParams]);
  const [state, setState] = useState<State>("loading");
  const [message, setMessage] = useState("Accepting your invitation…");
  const [orgPublicId, setOrgPublicId] = useState<string | null>(null);

  const nextPath = useMemo(() => {
    const q = token ? `?token=${encodeURIComponent(token)}` : "";
    return `/accept-org-invite${q}`;
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!token) {
        if (!cancelled) {
          setState("error");
          setMessage("Invitation link is missing or invalid.");
        }
        return;
      }
      if (!isReady) return;
      if (!accessToken) {
        if (!cancelled) {
          setState("need_sign_in");
          setMessage("Sign in with the email that received the invitation, then try again.");
        }
        return;
      }
      if (!cancelled) {
        setState("loading");
        setMessage("Accepting your invitation…");
      }
      try {
        const result = await acceptOrganizationInvite(token);
        if (cancelled) return;
        setOrgPublicId(result.organizationPublicId);
        setState("success");
        setMessage(`You joined ${result.organizationName}.`);
        notifyOrganizationsListChanged();
      } catch (err) {
        if (cancelled) return;
        setState("error");
        setMessage(err instanceof Error ? err.message : "Could not accept the invitation.");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [token, isReady, accessToken]);

  const orgHref = orgPublicId && orgPublicId.length > 0 ? "/projects" : "/";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="fixed top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      <div className="glass-panel w-full max-w-md space-y-6 rounded-2xl p-6">
        <div className="flex flex-col items-center text-center">
          <div className="relative mb-3 h-14 w-14 overflow-hidden rounded-2xl border border-primary/20 shadow-sm ring-1 ring-border/70">
            <Image
              src="/weehawk-logo.svg"
              alt="Weehawk"
              width={56}
              height={56}
              className="logo-adaptive size-14 scale-90 object-contain p-1"
              priority
            />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Organization invitation</h1>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        </div>

        {state === "loading" ? (
          <div className="flex justify-center py-2">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          {state === "success" ? (
            <Link href={orgHref} className="btn-primary w-full text-center">
              Open organization
            </Link>
          ) : null}
          {state === "need_sign_in" ? (
            <Link href={loginUrlWithNext(nextPath)} className="btn-primary w-full text-center">
              Sign in
            </Link>
          ) : null}
          <Link href="/" className="btn-secondary w-full text-center">
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
