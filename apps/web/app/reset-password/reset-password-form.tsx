"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { resetPassword } from "@/lib/auth-api";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/auth/password-input";
import { toast } from "@/hooks/use-toast";

const PW_HINT =
  "At least 8 characters with uppercase, lowercase, and a number.";

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      toast({ title: "Invalid link", description: "Missing token.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirm) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    setPending(true);
    try {
      await resetPassword(token, newPassword);
      toast({ title: "Password updated", description: "You can sign in now." });
      router.replace("/");
    } catch (err) {
      toast({
        title: "Could not reset password",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setPending(false);
    }
  }

  if (!token) {
    return (
      <AuthPageShell subtitle="Reset your password">
        <p className="text-sm text-muted-foreground text-center">
          This link is invalid or missing a token. Request a new reset email from the sign-in page.
        </p>
        <Button asChild className="w-full mt-4">
          <Link href="/">Back to sign in</Link>
        </Button>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell subtitle="Choose a new password.">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="np">New password</Label>
          <PasswordInput
            id="np"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
            placeholder="New password"
          />
          <p className="text-[11px] text-muted-foreground">{PW_HINT}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="npc">Confirm new password</Label>
          <PasswordInput
            id="npc"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
            placeholder="Confirm password"
          />
        </div>
        <Button type="submit" className="w-full gap-2" disabled={pending}>
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Update password
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground mt-6">
        <Link href="/" className="text-primary hover:underline font-medium">
          Back to sign in
        </Link>
      </p>
    </AuthPageShell>
  );
}
