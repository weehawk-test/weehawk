"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { useAuth } from "@/contexts/auth-context";
import { forgotPassword } from "@/lib/auth-api";
import { toast } from "@/hooks/use-toast";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { accessToken, isReady } = useAuth();

  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (accessToken) router.replace("/");
  }, [accessToken, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      const res = await forgotPassword(email.trim());
      toast({ title: "Check your inbox", description: res.message });
    } catch (err) {
      toast({
        title: "Request failed",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setPending(false);
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

  return (
    <AuthPageShell subtitle="We will email you a link to reset your password.">
      <form onSubmit={onSubmit} className="space-y-4">
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

        <Button type="submit" className="w-full gap-2" disabled={pending}>
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
          Send reset link
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground mt-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-primary hover:underline font-medium"
        >
          Back to sign in
        </Link>
      </p>
    </AuthPageShell>
  );
}
