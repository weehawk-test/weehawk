"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/inputs/password-input";
import { useAuth } from "@/contexts/auth-context";
import { changePassword, updateProfile } from "@/lib/user-api";
import type { UserProfile } from "@/lib/user-api";
import { toast } from "@/hooks/use-toast";
import { Loader2, User } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Props = {
  initialProfile: UserProfile;
};

export function ProfileClient({ initialProfile }: Props) {
  const { accessToken, user, updateUser } = useAuth();
  const [firstName, setFirstName] = useState(initialProfile.firstName);
  const [lastName, setLastName] = useState(initialProfile.lastName);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  useEffect(() => {
    setFirstName(initialProfile.firstName);
    setLastName(initialProfile.lastName);
  }, [initialProfile]);

  const saveMutation = useMutation({
    mutationFn: () =>
      updateProfile(accessToken!, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      }),
    onSuccess: (data) => {
      updateUser({ firstName: data.firstName, lastName: data.lastName });
      toast({ title: "Profile updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Could not save", description: err.message, variant: "destructive" });
    },
  });

  const passwordMutation = useMutation({
    mutationFn: () =>
      changePassword(accessToken!, {
        currentPassword,
        newPassword,
      }),
    onSuccess: (data) => {
      toast({ title: "Password updated", description: data.message });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    },
    onError: (err: Error) => {
      toast({ title: "Could not update password", description: err.message, variant: "destructive" });
    },
  });

  const p = initialProfile;
  const created = p?.createdAt ? new Date(p.createdAt) : null;
  const lastLogin = p?.lastLogin ? new Date(p.lastLogin) : null;

  const strongPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

  function submitPasswordChange() {
    if (newPassword !== confirmNewPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (!strongPassword.test(newPassword)) {
      toast({
        title: "Weak password",
        description: "Use at least 8 characters with uppercase, lowercase, and a number.",
        variant: "destructive",
      });
      return;
    }
    if (!currentPassword.trim()) {
      toast({ title: "Enter your current password", variant: "destructive" });
      return;
    }
    passwordMutation.mutate();
  }

  const infoFields = (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="profile-first">First name</Label>
          <Input
            id="profile-first"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
            minLength={2}
            maxLength={50}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="profile-last">Last name</Label>
          <Input
            id="profile-last"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="family-name"
            minLength={2}
            maxLength={50}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="profile-email">Email</Label>
        <Input
          id="profile-email"
          type="email"
          value={user?.email ?? p?.email ?? ""}
          disabled
          className="opacity-60 cursor-not-allowed"
        />
        <p className="text-[11px] text-muted-foreground">Email cannot be changed here.</p>
      </div>
    </>
  );

  const metaBlock = (
    <div className="text-xs text-muted-foreground space-y-1 border-t border-white/5 pt-4">
      {created && (
        <p>
          Member since{" "}
          <span className="text-foreground/80">{formatDistanceToNow(created, { addSuffix: true })}</span>
        </p>
      )}
      {lastLogin && (
        <p>
          Last login{" "}
          <span className="text-foreground/80">{formatDistanceToNow(lastLogin, { addSuffix: true })}</span>
        </p>
      )}
    </div>
  );

  return (
    <>
      <div className="max-w-lg">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <User className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Update your name as it appears in the app.</p>
          </div>
        </div>

        <div className="glass-panel rounded-2xl border border-white/10 p-6">
          <div className="space-y-6">
            {infoFields}
            {metaBlock}
            <Button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={
                saveMutation.isPending ||
                !firstName.trim() ||
                !lastName.trim() ||
                (firstName.trim() === p?.firstName && lastName.trim() === p?.lastName)
              }
              className="w-full gap-2 sm:w-auto"
            >
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Save changes
            </Button>
            <div className="border-t border-white/10 pt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="profile-current-password">Current password</Label>
                <PasswordInput
                  id="profile-current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="Enter current password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-new-password">New password</Label>
                <PasswordInput
                  id="profile-new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Enter new password"
                  minLength={8}
                  maxLength={72}
                />
                <p className="text-[11px] text-muted-foreground">
                  At least 8 characters with uppercase, lowercase, and a number.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-confirm-new-password">Confirm new password</Label>
                <PasswordInput
                  id="profile-confirm-new-password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Confirm new password"
                  minLength={8}
                  maxLength={72}
                />
              </div>
              <Button
                type="button"
                className="w-full gap-2 sm:w-auto"
                disabled={passwordMutation.isPending}
                onClick={submitPasswordChange}
              >
                {passwordMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : null}
                Update password
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
