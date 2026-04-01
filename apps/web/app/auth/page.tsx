"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { motion } from "framer-motion";
import { Loader2, Lock, LogIn, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/auth-context";
import {
  fetchSetupStatus,
  loginUser,
  registerUser,
} from "@/lib/auth-api";
import { toast } from "@/hooks/use-toast";

export default function AuthPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken, isReady, setSession } = useAuth();
  /** Always refetch from server: global default staleTime is Infinity, which kept needsSetup true after first signup. */
  const setupQuery = useQuery({
    queryKey: ["auth", "setup-status"],
    queryFn: fetchSetupStatus,
    staleTime: 0,
    gcTime: 0,
  });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (accessToken) router.replace("/");
  }, [accessToken, router]);

  const needsSetup = setupQuery.data?.needsSetup === true;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (needsSetup) {
        const res = await registerUser({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          password,
        });
        setSession(res);
        queryClient.setQueryData(["auth", "setup-status"], { needsSetup: false });
        void queryClient.invalidateQueries({ queryKey: ["auth", "setup-status"] });
        toast({ title: "Account created", description: "Welcome to weehawk." });
      } else {
        const res = await loginUser({
          email: email.trim().toLowerCase(),
          password,
        });
        setSession(res);
        toast({ title: "Signed in" });
      }
      router.replace("/");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Something went wrong. Please try again.";
      toast({ title: "Request failed", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  if (!isReady || accessToken) {
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

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background relative overflow-hidden px-4 py-12">
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-white/[0.04] rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-white/[0.03] rounded-full blur-[100px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md glass-panel rounded-2xl border border-white/10 p-8 shadow-xl relative z-10"
      >
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="relative w-12 h-12 rounded-xl overflow-hidden border border-primary/20 ring-1 ring-white/5">
            <Image
              src="/weehawk-logo.png"
              alt="weehawk"
              width={48}
              height={48}
              className="object-cover size-12"
              priority
            />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold tracking-tight">weehawk</h1>
            {needsSetup ? (
              <p className="text-sm text-muted-foreground mt-1">
                No accounts yet. Create the first administrator account to continue.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground mt-1">
                Sign in to continue.
              </p>
            )}
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {needsSetup && (
            <>
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
            </>
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
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={needsSetup ? "Create a strong password" : "Enter your password"}
              autoComplete={needsSetup ? "new-password" : "current-password"}
              required
              minLength={8}
            />
            {needsSetup && (
              <p className="text-[11px] text-muted-foreground">
                  At least 8 characters with uppercase, lowercase, and a number.
              </p>
            )}
          </div>

          <Button type="submit" className="w-full gap-2" disabled={submitting}>
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : needsSetup ? (
              <UserPlus className="w-4 h-4" />
            ) : (
              <LogIn className="w-4 h-4" />
            )}
            {needsSetup ? "Create account" : "Sign in"}
          </Button>
        </form>

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Lock className="w-3.5 h-3.5" />
          <span>Use HTTPS in production for a secure connection</span>
        </div>
      </motion.div>
    </div>
  );
}
