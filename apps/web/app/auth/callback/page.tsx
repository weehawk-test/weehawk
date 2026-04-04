"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { markOauthCloudOnboardingPending } from "@/lib/pending-onboarding-auth";
import { getProfile } from "@/lib/user-api";

/**
 * After Google OAuth the API sets httpOnly cookies and redirects here.
 */
export default function AuthOAuthCallbackPage() {
  const router = useRouter();
  const { setSession } = useAuth();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const profile = await getProfile("cookie-session");
        if (cancelled) return;
        setSession({
          accessToken: "cookie-session",
          refreshToken: "",
          tokenType: "Bearer",
          userId: profile.userId,
          firstName: profile.firstName,
          lastName: profile.lastName,
          email: profile.email,
          imageUrl: profile.imageUrl,
        });
        const onboarding =
          typeof window !== "undefined" &&
          new URLSearchParams(window.location.search).get("onboarding") === "1";
        if (onboarding) {
          markOauthCloudOnboardingPending();
          window.history.replaceState({}, "", "/auth/callback");
          router.replace("/onboarding/server");
        } else {
          router.replace("/");
        }
      } catch {
        if (!cancelled) {
          router.replace("/?oauth_error=Could%20not%20complete%20sign-in.%20Try%20again.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, setSession]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">Finishing sign-in…</p>
    </div>
  );
}
