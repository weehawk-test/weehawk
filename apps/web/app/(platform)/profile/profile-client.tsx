"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PasswordInput } from "@/components/auth/password-input";
import { useAuth } from "@/contexts/auth-context";
import {
  changePassword,
  requestEmailChange,
  resendConfirmationEmail,
  updateProfile,
} from "@/lib/user-api";
import type { UserProfile } from "@/lib/user-api";
import { toast } from "@/hooks/use-toast";
import { KeyRound, Loader2, Mail, User } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { isCloudEdition } from "@/lib/weehawk-edition";

type Props = {
  initialProfile: UserProfile;
};

export function ProfileClient({ initialProfile }: Props) {
  const { accessToken, user, updateUser } = useAuth();
  const [firstName, setFirstName] = useState(initialProfile.firstName);
  const [lastName, setLastName] = useState(initialProfile.lastName);
  const [newEmail, setNewEmail] = useState("");
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

  const emailChangeMutation = useMutation({
    mutationFn: () => requestEmailChange(accessToken!, newEmail.trim()),
    onSuccess: (data) => {
      toast({ title: "Check your email", description: data.message });
      setNewEmail("");
    },
    onError: (err: Error) => {
      toast({ title: "Could not start email change", description: err.message, variant: "destructive" });
    },
  });

  const resendConfirmationMutation = useMutation({
    mutationFn: () => resendConfirmationEmail(accessToken!),
    onSuccess: (data) => {
      toast({ title: "Email sent", description: data.message });
    },
    onError: (err: Error) => {
      toast({ title: "Could not resend", description: err.message, variant: "destructive" });
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
  const isCloud = isCloudEdition();
  const isLocal = p.authProvider === "LOCAL";
  const needsVerify = isCloud && isLocal && !p.emailVerified;

  const strongPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

  function submitPasswordChange() {
    if (!isLocal) return;
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
      {needsVerify ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 space-y-2">
          <div className="flex items-start gap-2">
            <Mail className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" aria-hidden />
            <p className="text-sm text-foreground/90">
              Your email is not verified yet. Check your inbox for the confirmation link, or resend it.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-amber-500/40"
            disabled={resendConfirmationMutation.isPending}
            onClick={() => resendConfirmationMutation.mutate()}
          >
            {resendConfirmationMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              "Resend confirmation email"
            )}
          </Button>
        </div>
      ) : null}
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
        {isCloud ? (
          <div className="space-y-2 pt-1">
            <Label htmlFor="profile-new-email" className="text-muted-foreground">
              New email
            </Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="profile-new-email"
                type="email"
                placeholder="New email (here)"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                autoComplete="off"
                className="min-w-0 flex-1"
              />
              <Button
                type="button"
                variant="secondary"
                className="shrink-0 sm:w-auto w-full"
                disabled={
                  emailChangeMutation.isPending ||
                  !newEmail.trim() ||
                  newEmail.trim().toLowerCase() === (user?.email ?? p.email).toLowerCase()
                }
                onClick={() => emailChangeMutation.mutate()}
              >
                {emailChangeMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Request change"
                )}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">Email cannot be changed here.</p>
        )}
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
            <p className="text-xs text-muted-foreground mt-0.5">
              {isCloud
                ? "Update your name, email, and password."
                : "Update your name as it appears in the app."}
            </p>
          </div>
        </div>

        <div className="glass-panel rounded-2xl border border-white/10 p-6">
          {isCloud ? (
            <Tabs defaultValue="info" className="w-full">
              <TabsList className="grid h-12 w-full grid-cols-2 gap-1 rounded-xl border border-border bg-muted/60 dark:bg-black/25 p-1.5 text-muted-foreground shadow-none">
                <TabsTrigger
                  value="info"
                  className="gap-2 rounded-lg px-3 py-2 text-sm font-medium shadow-none data-[state=active]:bg-white/10 data-[state=active]:text-foreground data-[state=active]:shadow-none"
                >
                  <User className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                  Info
                </TabsTrigger>
                <TabsTrigger
                  value="password"
                  className="gap-2 rounded-lg px-3 py-2 text-sm font-medium shadow-none data-[state=active]:bg-white/10 data-[state=active]:text-foreground data-[state=active]:shadow-none"
                >
                  <KeyRound className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                  Password
                </TabsTrigger>
              </TabsList>

              <TabsContent value="info" className="mt-6 space-y-6 outline-none">
                <div className="space-y-4">{infoFields}</div>
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
              </TabsContent>

              <TabsContent value="password" className="mt-6 space-y-4 outline-none">
                {!isLocal ? (
                  <p className="text-sm text-muted-foreground">
                    This account uses Google sign-in. Passwords are not used—continue signing in with Google.
                  </p>
                ) : (
                  <>
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
                  </>
                )}
              </TabsContent>
            </Tabs>
          ) : (
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
            </div>
          )}
        </div>
      </div>
    </>
  );
}
