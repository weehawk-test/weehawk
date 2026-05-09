"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, LockKeyhole, Trash2, UserRound, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { API_BASE } from "@/lib/api";
import {
  changePassword,
  deleteAccount,
  getProfile,
  requestEmailChange,
  resendConfirmationEmail,
  setPassword,
  unlinkGoogle,
  updateProfile,
} from "@/lib/user-api";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button";
import { PasswordInput } from "@/components/inputs/password-input";
import { cn } from "@/lib/utils";

/** User must type this exactly (case-insensitive) to confirm account deletion. */
const ACCOUNT_DELETE_CONFIRM_PHRASE = "delete";

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
  const { user, updateUser, logout } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [setPasswordValue, setSetPasswordValue] = useState("");
  const [setPasswordConfirmValue, setSetPasswordConfirmValue] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [hasPassword, setHasPassword] = useState(user?.provider === "LOCAL");
  const [changingPassword, setChangingPassword] = useState(false);
  const [settingPassword, setSettingPassword] = useState(false);
  const [unlinkingGoogle, setUnlinkingGoogle] = useState(false);
  const [requestingEmailChange, setRequestingEmailChange] = useState(false);
  const [resendingConfirmation, setResendingConfirmation] = useState(false);
  const [activeTab, setActiveTab] = useState<"profile" | "password">("profile");
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmPhrase, setDeleteConfirmPhrase] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const instanceMode = (process.env.NEXT_PUBLIC_INSTANCE_MODE ?? "cloud")
    .trim()
    .toLowerCase();
  const isSelfHosted = instanceMode === "self-hosted";
  const isGoogleLinked = Boolean(user?.providerId) || user?.provider === "GOOGLE";
  const googleLinkedEmail = user?.googleAccountEmail?.trim() || user?.email || "";

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error")?.trim();
    if (!err) return;
    setBannerError(err);
    toast({
      title: "Could not link Google",
      description: err,
      variant: "destructive",
    });
    router.replace("/profile", { scroll: false });
  }, [router, toast]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const p = await getProfile();
        if (cancelled) return;
        updateUser({
          provider: p.provider,
          providerId: p.providerId,
          googleAccountEmail: p.googleAccountEmail,
          emailVerified: p.emailVerified,
          imageUrl: p.imageUrl,
        });
        setHasPassword(p.hasPassword);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.userId, updateUser]);

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
        providerId: profile.providerId,
        googleAccountEmail: profile.googleAccountEmail,
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

  const onChangePassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const canChangePassword =
      !!user && (user.provider === "LOCAL" || (user.provider === "GOOGLE" && hasPassword));
    if (!canChangePassword) return;

    const currentPasswordValue = currentPassword.trim();
    const newPasswordValue = newPassword.trim();
    const confirmPasswordValue = confirmPassword.trim();

    if (!currentPasswordValue || !newPasswordValue || !confirmPasswordValue) {
      toast({
        title: "Missing fields",
        description: "All password fields are required.",
        variant: "destructive",
      });
      return;
    }

    if (newPasswordValue.length < 8) {
      toast({
        title: "Weak password",
        description: "New password must be at least 8 characters.",
        variant: "destructive",
      });
      return;
    }

    if (newPasswordValue !== confirmPasswordValue) {
      toast({
        title: "Passwords do not match",
        description: "Please confirm the new password correctly.",
        variant: "destructive",
      });
      return;
    }

    if (currentPasswordValue === newPasswordValue) {
      toast({
        title: "No changes detected",
        description: "New password must be different from current password.",
        variant: "destructive",
      });
      return;
    }

    setChangingPassword(true);
    try {
      const result = await changePassword({
        currentPassword: currentPasswordValue,
        newPassword: newPasswordValue,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({
        title: "Password updated",
        description: result.message || "Your password was changed successfully.",
      });
    } catch (err) {
      toast({
        title: "Could not change password",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setChangingPassword(false);
    }
  };

  const onRequestEmailChange = async () => {
    if (!user) return;
    const nextEmail = newEmail.trim().toLowerCase();

    if (!nextEmail) {
      toast({
        title: "Missing email",
        description: "Please enter a new email address.",
        variant: "destructive",
      });
      return;
    }

    const isEmailLike = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail);
    if (!isEmailLike) {
      toast({
        title: "Invalid email",
        description: "Please enter a valid email address.",
        variant: "destructive",
      });
      return;
    }

    if (nextEmail === (user.email ?? "").trim().toLowerCase()) {
      toast({
        title: "No changes detected",
        description: "New email must be different from your current email.",
        variant: "destructive",
      });
      return;
    }

    setRequestingEmailChange(true);
    try {
      const result = await requestEmailChange({ newEmail: nextEmail });
      setNewEmail("");
      toast({
        title: "Email change requested",
        description: result.message || "Please check your new email for confirmation.",
      });
    } catch (err) {
      toast({
        title: "Could not request email change",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setRequestingEmailChange(false);
    }
  };

  const onResendConfirmation = async () => {
    if (!user || user.emailVerified) return;
    setResendingConfirmation(true);
    try {
      const result = await resendConfirmationEmail();
      toast({
        title: "Check your inbox",
        description: result.message || "We sent you a confirmation link.",
      });
    } catch (err) {
      toast({
        title: "Could not resend email",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setResendingConfirmation(false);
    }
  };

  const onSetPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || user.provider !== "GOOGLE") return;

    const nextPassword = setPasswordValue.trim();
    const confirm = setPasswordConfirmValue.trim();

    if (!nextPassword || !confirm) {
      toast({
        title: "Missing fields",
        description: "Please fill both password fields.",
        variant: "destructive",
      });
      return;
    }
    if (nextPassword.length < 8) {
      toast({
        title: "Weak password",
        description: "Password must be at least 8 characters.",
        variant: "destructive",
      });
      return;
    }
    if (!/[a-z]/.test(nextPassword) || !/[A-Z]/.test(nextPassword) || !/\d/.test(nextPassword)) {
      toast({
        title: "Weak password",
        description: "Password must include uppercase, lowercase and a number.",
        variant: "destructive",
      });
      return;
    }
    if (nextPassword !== confirm) {
      toast({
        title: "Passwords do not match",
        description: "Please confirm the password correctly.",
        variant: "destructive",
      });
      return;
    }

    setSettingPassword(true);
    try {
      const result = await setPassword({ newPassword: nextPassword });
      setSetPasswordValue("");
      setSetPasswordConfirmValue("");
      setHasPassword(true);
      toast({
        title: "Password set",
        description: result.message || "Your password has been set successfully.",
      });
    } catch (err) {
      toast({
        title: "Could not set password",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSettingPassword(false);
    }
  };

  const onConfirmDeleteAccount = async () => {
    if (!user) return;
    if (deleteConfirmPhrase.trim().toLowerCase() !== ACCOUNT_DELETE_CONFIRM_PHRASE) {
      toast({
        title: "Confirmation does not match",
        description: `Type ${ACCOUNT_DELETE_CONFIRM_PHRASE} exactly to confirm.`,
        variant: "destructive",
      });
      return;
    }
    setDeletingAccount(true);
    try {
      const result = await deleteAccount();
      setDeleteDialogOpen(false);
      toast({
        title: "Account deleted",
        description: result.message || "Your account was removed.",
      });
      await logout();
      router.replace("/login");
    } catch (err) {
      toast({
        title: "Could not delete account",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDeletingAccount(false);
    }
  };

  const onUnlinkGoogle = async () => {
    if (!user || !isGoogleLinked) return;
    if (!hasPassword) {
      toast({
        title: "Set a password first",
        description:
          "You need a password on your account before you can unlink Google. Use the Password tab to set one.",
        variant: "destructive",
      });
      return;
    }
    setUnlinkingGoogle(true);
    try {
      const result = await unlinkGoogle();
      updateUser({ provider: "LOCAL", providerId: null, googleAccountEmail: null });
      setActiveTab("profile");
      toast({
        title: "Google unlinked",
        description: result.message || "Your Google account was unlinked successfully.",
      });
    } catch (err) {
      toast({
        title: "Could not unlink Google",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setUnlinkingGoogle(false);
    }
  };

  return (
    <div className="max-w-xl mr-auto">
      <div className="glass-panel rounded-2xl p-6 sm:p-7 space-y-6 text-left">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Edit profile</h1>
          <p className="text-sm text-muted-foreground mt-1">Update your account information.</p>
        </div>

        {bannerError ? (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-medium leading-none tracking-tight">Could not link Google</p>
              <p className="text-destructive/95 leading-relaxed">{bannerError}</p>
            </div>
            <button
              type="button"
              onClick={() => setBannerError(null)}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-destructive/30 bg-background text-destructive shadow-sm hover:bg-destructive/10 transition-colors"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : null}

        {isGoogleLinked ? (
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
                <p className="text-sm text-muted-foreground truncate" title={googleLinkedEmail}>
                  {googleLinkedEmail}
                </p>
              </div>
              <button
                type="button"
                onClick={onUnlinkGoogle}
                disabled={unlinkingGoogle}
                className="h-8 shrink-0 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 text-xs font-medium text-red-500 hover:bg-red-500/20 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5"
              >
                {unlinkingGoogle ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Unlink
              </button>
            </div>
          </div>
        ) : null}

        {user && !isGoogleLinked && !isSelfHosted ? (
          <div className="rounded-xl border border-border/70 bg-muted/25 dark:bg-muted/15 p-4 shadow-sm ring-1 ring-black/[0.03] dark:ring-white/[0.06]">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
              Link account
            </p>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-background border border-border/60 shadow-sm">
                  <GoogleMark className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">Google</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">Connect Google to sign in with it on this account.</p>
                </div>
              </div>
              <a
                href={`${API_BASE}/api/oauth2/google-link/start`}
                className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-border/80 bg-background px-3 text-sm font-medium text-foreground shadow-sm hover:bg-muted/50 transition-colors sm:self-center"
              >
                Link
              </a>
            </div>
          </div>
        ) : null}

        {user?.provider === "LOCAL" || user?.provider === "GOOGLE" ? (
          <div className="rounded-xl border border-border/70 bg-muted/25 dark:bg-muted/15 p-1 grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => setActiveTab("profile")}
              className={`h-10 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                activeTab === "profile"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/70"
              }`}
            >
              <UserRound className="h-4 w-4" />
              Profile
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("password")}
              className={`h-10 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                activeTab === "password"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/70"
              }`}
            >
              <LockKeyhole className="h-4 w-4" />
              {user?.provider === "GOOGLE" && !hasPassword ? "Set password" : "Password"}
            </button>
          </div>
        ) : null}

        {activeTab === "profile" ? (
          <form className="space-y-5 text-left" onSubmit={onSave}>
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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-sm text-muted-foreground">Account email</label>
                {user?.emailVerified === false ? (
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                      Unverified
                    </span>
                    <button
                      type="button"
                      onClick={onResendConfirmation}
                      disabled={resendingConfirmation}
                      className="h-7 shrink-0 rounded-md border border-border/80 bg-background px-2.5 text-xs font-medium text-foreground shadow-sm hover:bg-muted/60 transition-colors disabled:opacity-60 inline-flex items-center gap-1.5"
                    >
                      {resendingConfirmation ? (
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                      ) : null}
                      Resend link
                    </button>
                  </div>
                ) : null}
              </div>
              <input
                type="email"
                value={user?.email ?? ""}
                className="input-field opacity-70 bg-muted/40"
                placeholder="your@email.com"
                disabled
              />
            </div>
            {user?.provider === "LOCAL" || user?.provider === "GOOGLE" ? (
              <div className="rounded-xl border border-border/70 bg-muted/20 dark:bg-muted/10 p-4 space-y-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Change account email</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    We will send a confirmation link to your new email address.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
                  <div className="space-y-1">
                    <label className="text-sm text-muted-foreground">New email address</label>
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      className="input-field"
                      placeholder="new@email.com"
                      autoComplete="email"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={onRequestEmailChange}
                    disabled={requestingEmailChange || !user}
                    className="btn-secondary h-[46px] px-5 whitespace-nowrap flex items-center justify-center gap-2"
                  >
                    {requestingEmailChange ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Request change
                  </button>
                </div>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={saving || !user}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Save changes
            </button>
          </form>
        ) : null}

        {activeTab === "password" &&
        (user?.provider === "LOCAL" || (user?.provider === "GOOGLE" && hasPassword)) ? (
          <form className="space-y-4 text-left" onSubmit={onChangePassword}>
            <div className="space-y-1">
              <label className="text-sm text-muted-foreground">Current password</label>
              <PasswordInput
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm text-muted-foreground">New password</label>
              <PasswordInput
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm text-muted-foreground">Confirm new password</label>
              <PasswordInput
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                autoComplete="new-password"
              />
            </div>
            <button
              type="submit"
              disabled={changingPassword || !user}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {changingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Change password
            </button>
          </form>
        ) : null}

        {user?.provider === "GOOGLE" && !hasPassword && activeTab === "password" ? (
          <div className="space-y-4 text-left">
            <form className="space-y-4" onSubmit={onSetPassword}>
              <div className="space-y-1">
                <label className="text-sm text-muted-foreground">New password</label>
                <PasswordInput
                  value={setPasswordValue}
                  onChange={(e) => setSetPasswordValue(e.target.value)}
                  placeholder="Enter new password"
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm text-muted-foreground">Confirm password</label>
                <PasswordInput
                  value={setPasswordConfirmValue}
                  onChange={(e) => setSetPasswordConfirmValue(e.target.value)}
                  placeholder="Confirm new password"
                  autoComplete="new-password"
                />
              </div>
              <button
                type="submit"
                disabled={settingPassword}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {settingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Set password
              </button>
            </form>
          </div>
        ) : null}

        {user ? (
          <>
            <div className="rounded-xl border border-red-500/30 bg-red-500/[0.06] dark:bg-red-500/[0.08] p-4 space-y-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-red-600/90 dark:text-red-400/90">
                  Danger zone
                </p>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  Permanently delete your account and profile data. You will be signed out. This cannot
                  be undone.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDeleteConfirmPhrase("");
                  setDeleteDialogOpen(true);
                }}
                disabled={deletingAccount}
                className="inline-flex h-9 w-full sm:w-auto items-center justify-center gap-2 rounded-md border border-red-500/45 bg-red-500/10 px-3 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
                Delete account
              </button>
            </div>

            <Dialog
              open={deleteDialogOpen}
              onOpenChange={(open) => {
                if (!open && deletingAccount) return;
                if (!open) setDeleteConfirmPhrase("");
                setDeleteDialogOpen(open);
              }}
            >
              <DialogContent className="z-[120] border-border/80 sm:rounded-lg [&>button]:hidden">
                <DialogHeader>
                  <DialogTitle>Delete your account?</DialogTitle>
                  <DialogDescription asChild>
                    <div className="space-y-4 text-left text-muted-foreground">
                      <p>
                        This permanently deletes your profile, projects, services, webhooks, saved
                        servers, and other data tied to this account. If you rely on this environment,
                        export or migrate first.
                      </p>
                      <div className="space-y-2.5">
                        <label className="text-sm font-medium text-foreground block" htmlFor="delete-account-confirm">
                          Type{" "}
                          <span className="font-mono font-semibold text-red-600 dark:text-red-400">
                            &quot;{ACCOUNT_DELETE_CONFIRM_PHRASE}&quot;
                          </span>{" "}
                          to confirm
                        </label>
                        <input
                          id="delete-account-confirm"
                          type="text"
                          value={deleteConfirmPhrase}
                          onChange={(e) => setDeleteConfirmPhrase(e.target.value)}
                          className="input-field font-mono text-sm"
                          placeholder={ACCOUNT_DELETE_CONFIRM_PHRASE}
                          autoComplete="off"
                          autoCorrect="off"
                          spellCheck={false}
                          disabled={deletingAccount}
                        />
                      </div>
                    </div>
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <button
                    type="button"
                    disabled={deletingAccount}
                    className={cn(buttonVariants({ variant: "outline" }), "mt-2 sm:mt-0")}
                    onClick={() => {
                      setDeleteConfirmPhrase("");
                      setDeleteDialogOpen(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={
                      deletingAccount ||
                      deleteConfirmPhrase.trim().toLowerCase() !== ACCOUNT_DELETE_CONFIRM_PHRASE
                    }
                    className={cn(buttonVariants({ variant: "destructive" }), "gap-2")}
                    onClick={() => void onConfirmDeleteAccount()}
                  >
                    {deletingAccount ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : null}
                    Delete permanently
                  </button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        ) : null}
      </div>
    </div>
  );
}
