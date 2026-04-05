"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, LogIn, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/auth/password-input";
import {
  AuthEmailDivider,
  GoogleOAuthButton,
} from "@/components/auth/google-oauth-button";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { useAuth } from "@/contexts/auth-context";
import {
  fetchSetupStatus,
  loginUser,
  registerUser,
  type SetupStatus,
} from "@/lib/auth-api";
import { toast } from "@/hooks/use-toast";
import { savePendingOnboardingAuth } from "@/lib/pending-onboarding-auth";

/** Sign-in / first-user setup at `/` (no sidebar). */
export function SignInPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken, isReady, setSession } = useAuth();
  const setupQuery = useQuery({
    queryKey: ["auth", "setup-status"],
    queryFn: fetchSetupStatus,
    staleTime: 0,
    gcTime: 0,
  });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (accessToken) router.replace("/");
  }, [accessToken, router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const err = params.get("oauth_error");
    if (!err) return;
    toast({
      title: "Google sign-in failed",
      description: err,
      variant: "destructive",
    });
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const edition = setupQuery.data?.edition ?? "selfhosted";
  const isCloud = edition === "cloud";
  const needsSetup = setupQuery.data?.needsSetup === true;
  const isRegisterForm = needsSetup;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isRegisterForm && password !== confirmPassword) {
      toast({
        title: "Passwords do not match",
        description: "Re-enter your password in both fields.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      if (isRegisterForm) {
        const res = await registerUser({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          password,
        });
        savePendingOnboardingAuth(res);
        router.push("/onboarding/server");
        queryClient.setQueryData(
          ["auth", "setup-status"],
          (prev: SetupStatus | undefined) => ({
            edition: prev?.edition ?? edition,
            needsSetup: false,
            hasUsers: true,
          }),
        );
        void queryClient.invalidateQueries({ queryKey: ["auth", "setup-status"] });
        toast({ title: "Account created", description: "Welcome to Weehawk." });
      } else {
        const res = await loginUser({
          email: email.trim().toLowerCase(),
          password,
        });
        setSession(res);
        toast({ title: "Signed in" });
        router.replace("/");
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Something went wrong. Please try again.";
      toast({ title: "Request failed", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  if (!isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (accessToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (setupQuery.isPending || setupQuery.isError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3 px-4">
        {setupQuery.isError ? (
          <>
            <p className="text-sm text-destructive text-center max-w-md">
              Could not reach the server. Make sure the API is running and{" "}
              <code className="text-xs bg-muted px-1 rounded">NEXT_PUBLIC_API_URL</code> is correct.
            </p>
            <Button type="button" variant="outline" onClick={() => setupQuery.refetch()}>
              Try again
            </Button>
          </>
        ) : (
          <>
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading…</p>
          </>
        )}
      </div>
    );
  }

  const subtitle = isCloud ? (
    "Sign in to continue."
  ) : needsSetup ? (
    "No accounts yet. Create the first administrator account to continue."
  ) : (
    "Sign in to continue."
  );

  return (
    <AuthPageShell subtitle={subtitle}>
      {isCloud && (
        <>
          <GoogleOAuthButton variant={isRegisterForm ? "sign-up" : "sign-in"} />
          <AuthEmailDivider />
        </>
      )}
      <form onSubmit={onSubmit} className="space-y-4">
        {isRegisterForm && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="firstName">First name</Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="John"
                autoComplete="given-name"
                required
                minLength={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last name</Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Doe"
                autoComplete="family-name"
                required
                minLength={2}
              />
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            autoComplete="email"
            required
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="password">Password</Label>
            {isCloud && !isRegisterForm && (
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-primary hover:underline shrink-0"
              >
                Forgot password?
              </Link>
            )}
          </div>
          <PasswordInput
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isRegisterForm ? "Create a strong password" : "Enter your password"}
            autoComplete={isRegisterForm ? "new-password" : "current-password"}
            required
            minLength={8}
          />
        </div>

        {isRegisterForm && (
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <PasswordInput
              id="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter your password"
              autoComplete="new-password"
              required
              minLength={8}
            />
          </div>
        )}

        <Button type="submit" className="w-full gap-2" disabled={submitting}>
          {submitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : isRegisterForm ? (
            <UserPlus className="w-4 h-4" />
          ) : (
            <LogIn className="w-4 h-4" />
          )}
          {isRegisterForm ? "Create account" : "Sign in"}
        </Button>
      </form>

      {isCloud && !isRegisterForm && (
        <p className="text-center text-sm text-muted-foreground mt-6">
          Need an account?{" "}
          <Link href="/register" className="text-primary hover:underline font-medium">
            Create one
          </Link>
        </p>
      )}
    </AuthPageShell>
  );
}
