"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { loginApi } from "@/lib/auth-api";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/theme-toggle";
import { API_BASE } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const { accessToken, isReady, setSession } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isReady && accessToken) {
      router.replace("/");
    }
  }, [isReady, accessToken, router]);

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
      const { auth, user } = await loginApi({
        email: email.trim(),
        password,
      });
      setSession({
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        userId: user.userId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      });
      router.replace("/");
    } catch (err) {
      toast({
        title: "Login failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const continueWithGoogle = () => {
    const oauthUrl = new URL("/api/oauth2/authorize/google", API_BASE);
    window.location.href = oauthUrl.toString();
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
          <p className="text-sm text-muted-foreground mt-1">Use your Weehawk account.</p>
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

        <form className="space-y-4" onSubmit={onSubmit}>
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
            <div className="flex items-center justify-between">
              <label className="text-sm text-muted-foreground">Password</label>
              <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                Forgot password?
              </Link>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Sign in
          </button>
        </form>

        <p className="text-sm text-muted-foreground">
          No account yet?{" "}
          <Link href="/register" className="text-primary hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}

