"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";
import { AuthHttpError, getAuthStatusApi, loginApi } from "@/lib/auth-api";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useRateLimitCountdown } from "@/hooks/use-rate-limit-countdown";
import { ThemeToggle } from "@/components/theme-toggle";
import { PasswordInput } from "@/components/inputs/password-input";
import { API_BASE } from "@/lib/api";

function safeInternalNext(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (!t.startsWith("/") || t.startsWith("//")) return null;
  return t;
}

export default function LoginPage() {
  const envInstanceMode = (process.env.NEXT_PUBLIC_INSTANCE_MODE || "cloud")
    .trim()
    .toLowerCase();
  const [resolvedMode, setResolvedMode] = useState<"cloud" | "self-hosted">(
    envInstanceMode === "self-hosted" ? "self-hosted" : "cloud",
  );
  const isSelfHosted = resolvedMode === "self-hosted";
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextAfterAuth = useMemo(
    () => safeInternalNext(searchParams.get("next")),
    [searchParams],
  );
  const { accessToken, isReady, setSession } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [blockedUntilMs, setBlockedUntilMs] = useState<number | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [userConfigured, setUserConfigured] = useState<boolean | null>(null);
  const { secondsLeft, label } = useRateLimitCountdown(blockedUntilMs);

  useEffect(() => {
    if (!isReady || !accessToken) return;
    const err = searchParams.get("error")?.trim();
    if (err) return;
    router.replace(nextAfterAuth ?? "/");
  }, [isReady, accessToken, router, nextAfterAuth, searchParams]);

  useEffect(() => {
    const err = searchParams.get("error")?.trim();
    if (!err) return;
    setBannerError(err);
    toast({
      title: "Could not complete sign-in",
      description: err,
      variant: "destructive",
    });
    const qp = new URLSearchParams();
    if (nextAfterAuth) qp.set("next", nextAfterAuth);
    router.replace(qp.toString() ? `/login?${qp.toString()}` : "/login", { scroll: false });
  }, [router, toast, nextAfterAuth, searchParams]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const status = await getAuthStatusApi();
        if (!active) return;
        if (status.instanceMode === "self-hosted") {
          setResolvedMode("self-hosted");
          setUserConfigured(status.userConfigured);
          if (!status.userConfigured) {
            router.replace("/register");
          }
        } else {
          setResolvedMode("cloud");
        }
      } catch {
        // Keep default enabled state if status endpoint is temporarily unavailable.
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast({
        title: "Missing fields",
        description: "Email and password are required.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const { user } = await loginApi({
        email: email.trim(),
        password,
      });
      setSession({
        userId: user.userId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        provider: user.provider,
        emailVerified: user.emailVerified,
        imageUrl: user.imageUrl ?? null,
      });
      router.replace(nextAfterAuth ?? "/");
    } catch (err) {
      if (err instanceof AuthHttpError && err.status === 429) {
        const waitSec = err.retryAfterSeconds ?? 15 * 60;
        setBlockedUntilMs(Date.now() + waitSec * 1000);
        toast({
          title: "Too many sign-in attempts",
          description: "Please wait before trying again. A countdown is shown below.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Login failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="fixed top-4 right-4 z-20">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md glass-panel rounded-2xl p-6 space-y-6">
        <div className="flex flex-col items-center text-center">
          <div className="relative w-14 h-14 rounded-2xl overflow-hidden border border-primary/20 shadow-sm ring-1 ring-border/70 mb-3">
            <Image
              src="/weehawk-logo.svg"
              alt="Weehawk"
              width={56}
              height={56}
              className="logo-adaptive object-contain size-14 p-1 scale-90"
              priority
            />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isSelfHosted ? "Sign in to your account." : "Use your Weehawk account."}
          </p>
        </div>

        {bannerError ? (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3 text-left text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-medium leading-none tracking-tight">Something went wrong</p>
              <p className="text-destructive/95 leading-relaxed">{bannerError}</p>
            </div>
            <button
              type="button"
              onClick={() => setBannerError(null)}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-destructive/30 bg-background text-destructive shadow-sm hover:bg-destructive/10 transition-colors"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : null}

        {!isSelfHosted && (
          <>
            <button
              type="button"
              onClick={() => {
                const oauthBase = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080")
                  .trim()
                  .replace(/\/+$/, "");
                window.location.href = `${oauthBase}/api/oauth2/authorize/google`;
              }}
              className="btn-secondary w-full flex items-center justify-center gap-2"
            >
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-black text-xs font-bold">
                G
              </span>
              Continue with Google
            </button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>
          </>
        )}

        {secondsLeft > 0 ? (
          <div
            className="rounded-xl border border-amber-500/35 bg-amber-500/10 dark:bg-amber-500/15 px-4 py-3 text-sm text-amber-950 dark:text-amber-100"
            role="status"
            aria-live="polite"
          >
            <span className="text-amber-900/90 dark:text-amber-50/90">
              Too many attempts. Try again in{" "}
            </span>
            <span className="font-mono font-semibold tabular-nums">{label}</span>
          </div>
        ) : null}

        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-1">
            <label className="text-sm text-muted-foreground">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              placeholder="you@weehawk.io"
              autoComplete="email"
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-sm text-muted-foreground">Password</label>
              {!isSelfHosted && (
                <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                  Forgot password?
                </Link>
              )}
            </div>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || secondsLeft > 0}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Sign in
          </button>
        </form>

        {(!isSelfHosted || userConfigured === false) && (
          <p className="text-sm text-muted-foreground">
            No account yet?{" "}
            <Link href="/register" className="text-primary hover:underline">
              Create one
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

