"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { AuthHttpError, registerApi } from "@/lib/auth-api";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useRateLimitCountdown } from "@/hooks/use-rate-limit-countdown";
import { ThemeToggle } from "@/components/theme-toggle";
import { PasswordInput } from "@/components/inputs/password-input";
import { API_BASE, normalizeApiBase } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const { accessToken, isReady, setSession } = useAuth();
  const { toast } = useToast();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [blockedUntilMs, setBlockedUntilMs] = useState<number | null>(null);
  const { secondsLeft, label } = useRateLimitCountdown(blockedUntilMs);

  useEffect(() => {
    if (isReady && accessToken) router.replace("/");
  }, [isReady, accessToken, router]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !password) {
      toast({
        title: "Missing fields",
        description: "Please complete all required fields.",
        variant: "destructive",
      });
      return;
    }
    if (password !== confirmPassword) {
      toast({
        title: "Password mismatch",
        description: "Password and confirmation do not match.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const { user } = await registerApi({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        password,
      });
      setSession({
        userId: user.userId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        provider: user.provider,
        emailVerified: user.emailVerified,
        imageUrl: user.imageUrl ?? null,
      });
      router.replace("/");
    } catch (err) {
      if (err instanceof AuthHttpError && err.status === 429) {
        const waitSec = err.retryAfterSeconds ?? 15 * 60;
        setBlockedUntilMs(Date.now() + waitSec * 1000);
        toast({
          title: "Too many registration attempts",
          description: "Please wait before trying again. A countdown is shown below.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Registration failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const continueWithGoogle = () => {
    const oauthBase = normalizeApiBase(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080");
    window.location.href = `${oauthBase}/api/oauth2/authorize/google`;
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
          <h1 className="text-2xl font-bold tracking-tight">Create account</h1>
          <p className="text-sm text-muted-foreground mt-1">Start using Weehawk with your account.</p>
        </div>

        <button
          type="button"
          onClick={continueWithGoogle}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm text-muted-foreground">First name</label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="input-field"
                placeholder="John"
                autoComplete="given-name"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm text-muted-foreground">Last name</label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="input-field"
                placeholder="Doe"
                autoComplete="family-name"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm text-muted-foreground">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm text-muted-foreground">Password</label>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm text-muted-foreground">Confirm password</label>
            <PasswordInput
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat password"
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || secondsLeft > 0}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Create account
          </button>
        </form>

        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

