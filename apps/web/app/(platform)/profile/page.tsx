"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { getProfile, updateProfile } from "@/lib/user-api";
import { useToast } from "@/hooks/use-toast";

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.574l.001-.001 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

export default function ProfilePage() {
  const { user, updateUser } = useAuth();
  const { toast } = useToast();
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user || user.provider) return;
    let cancelled = false;
    void (async () => {
      try {
        const p = await getProfile();
        if (cancelled) return;
        updateUser({
          provider: p.provider,
          emailVerified: p.emailVerified,
          imageUrl: p.imageUrl,
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.userId, user?.provider, updateUser]);

  const onSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    if (!firstName.trim() || !lastName.trim()) {
      toast({
        title: "Missing fields",
        description: "First name and last name are required.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const profile = await updateProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      updateUser({
        firstName: profile.firstName,
        lastName: profile.lastName,
        provider: profile.provider,
      });
      toast({ title: "Profile updated", description: "Your profile was saved successfully." });
    } catch (err) {
      toast({
        title: "Could not update profile",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl mr-auto">
      <div className="glass-panel rounded-2xl p-6 space-y-5 text-left">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Edit profile</h1>
          <p className="text-sm text-muted-foreground mt-1">Update your account information.</p>
        </div>

        {user?.provider === "GOOGLE" ? (
          <div className="rounded-xl border border-border/70 bg-muted/25 dark:bg-muted/15 p-4 shadow-sm ring-1 ring-black/[0.03] dark:ring-white/[0.06]">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
              Linked account
            </p>
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-background border border-border/60 shadow-sm">
                <GoogleMark className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">Google</p>
                <p className="text-sm text-muted-foreground truncate" title={user.email}>
                  {user.email}
                </p>
              </div>
            </div>
          </div>
        ) : user?.provider === "LOCAL" ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Linked account
            </p>
            <p className="text-sm font-medium text-foreground">Email &amp; password</p>
          </div>
        ) : null}

        <form className="space-y-4 text-left" onSubmit={onSave}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm text-muted-foreground">First name</label>
              <input
                type="text"
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
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="input-field"
                placeholder="Doe"
                autoComplete="family-name"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm text-muted-foreground">Account email</label>
            <input
              type="email"
              value={user?.email ?? ""}
              className="input-field opacity-70"
              disabled />
          </div>

          <button
            type="submit"
            disabled={saving || !user}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Save changes
          </button>
        </form>
      </div>
    </div>
  );
}
