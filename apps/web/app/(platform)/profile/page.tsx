"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { updateProfile } from "@/lib/user-api";
import { useToast } from "@/hooks/use-toast";

export default function ProfilePage() {
  const { accessToken, user, updateUser } = useAuth();
  const { toast } = useToast();
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [saving, setSaving] = useState(false);

  const onSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!accessToken) return;
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
      const profile = await updateProfile(accessToken, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      updateUser({ firstName: profile.firstName, lastName: profile.lastName });
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
            <label className="text-sm text-muted-foreground">Email</label>
            <input
              type="email"
              value={user?.email ?? ""}
              className="input-field opacity-70"
              disabled
            />
          </div>

          <button
            type="submit"
            disabled={saving || !accessToken}
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
