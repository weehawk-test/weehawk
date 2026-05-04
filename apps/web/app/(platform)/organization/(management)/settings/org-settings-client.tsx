"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2, LogOut, Pencil } from "lucide-react";
import {
  fetchOrganizations,
  leaveOrganization,
  notifyOrganizationsListChanged,
  updateOrganization,
} from "@/lib/organizations-api";
import { pickDefaultWorkspaceOrganization } from "@/lib/pick-primary-owned-org";
import {
  clearActiveOrganizationPublicBrowserCookie,
  setActiveOrganizationPublicBrowserCookie,
} from "@/lib/active-org-cookie";
import { useOrgWorkspace } from "@/(platform)/org-workspace/org-workspace-context";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function OrgSettingsClient() {
  const org = useOrgWorkspace();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(org.name);
  const [savingName, setSavingName] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    setName(org.name);
  }, [org.name]);

  const nameDirty = name.trim() !== org.name.trim();
  /** Renaming the organization is owner-only (Settings tab may still be visible for delegates). */
  const canEditName = org.isOwner;

  const onSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditName || savingName || !nameDirty) return;
    setSavingName(true);
    try {
      await updateOrganization(org.publicId, { name: name.trim() });
      toast({ title: "Organization updated", description: "Name saved." });
      router.refresh();
    } catch (err) {
      toast({
        title: "Could not save",
        description: err instanceof Error ? err.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setSavingName(false);
    }
  };

  const onConfirmLeave = async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      const { message } = await leaveOrganization(org.publicId);
      toast({ title: "Left organization", description: message });
      setLeaveOpen(false);
      const remaining = await fetchOrganizations();
      const next = pickDefaultWorkspaceOrganization(remaining);
      queryClient.clear();
      notifyOrganizationsListChanged();
      if (next?.publicId?.trim()) {
        setActiveOrganizationPublicBrowserCookie(next.publicId);
        queueMicrotask(() => {
          router.push("/projects");
          router.refresh();
        });
      } else {
        clearActiveOrganizationPublicBrowserCookie();
        queueMicrotask(() => {
          router.push("/organizations/create");
          router.refresh();
        });
      }
    } catch (err) {
      toast({
        title: "Could not leave",
        description: err instanceof Error ? err.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setLeaving(false);
    }
  };

  const createdLabel = new Date(org.createdAt).toLocaleDateString(undefined, { dateStyle: "long" });

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-border/80 bg-card/30 p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/60">
            <Building2 className="size-5 text-muted-foreground" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">Organization details</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Public id <span className="font-mono text-foreground">{org.publicId}</span>
              {" · "}
              Created {createdLabel}
              {" · "}
              {org.memberCount} {org.memberCount === 1 ? "member" : "members"}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border/80 bg-card/30 p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Pencil className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="text-base font-semibold text-foreground">Display name</h2>
        </div>
        {!canEditName ? (
          <p className="mb-3 text-sm text-amber-700 dark:text-amber-400/90">
            Only organization owners can change the display name. Contact an owner if you need it updated.
          </p>
        ) : null}
        {canEditName ? (
          <form onSubmit={onSaveName} className="max-w-lg space-y-4">
            <div>
              <label htmlFor="org-name" className="mb-1.5 block text-sm font-medium text-foreground">
                Name
              </label>
              <input
                id="org-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                className="input-field w-full"
                autoComplete="organization"
                disabled={savingName}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">Visible to all members in this organization.</p>
            </div>
            <button
              type="submit"
              disabled={savingName || !nameDirty || !name.trim()}
              className="btn-primary inline-flex items-center justify-center gap-2"
            >
              {savingName ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Save name
            </button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            Current name: <span className="font-medium text-foreground">{org.name}</span>
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <LogOut className="size-4 text-destructive" aria-hidden />
          <h2 className="text-base font-semibold text-foreground">Leave organization</h2>
        </div>
        <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
          You will lose access to this organization’s shared projects and settings. You can join again if an owner
          invites you. If you are the only member, the organization is closed and{" "}
          <span className="font-medium text-foreground">all of its data is permanently deleted</span> (projects,
          servers, webhooks, cron jobs, notifications, S3 profiles, and related workspace records).
        </p>
        <button
          type="button"
          onClick={() => setLeaveOpen(true)}
          className="btn-secondary border-destructive/40 text-destructive hover:bg-destructive/10"
        >
          Leave organization
        </button>
        <AlertDialog open={leaveOpen} onOpenChange={(open) => !leaving && setLeaveOpen(open)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Leave this organization?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm text-muted-foreground">
                  {!org.isOwner ? (
                    <p>
                      You will lose access until someone invites you back to{" "}
                      <span className="font-medium text-foreground">{org.name}</span>.
                    </p>
                  ) : org.memberCount <= 1 ? (
                    <p>
                      You are the only member. Leaving will close this organization and{" "}
                      <span className="font-medium text-foreground">permanently delete all of its workspace data</span>.
                      This cannot be undone.
                    </p>
                  ) : (
                    <p>
                      If you are the only owner, another member will be promoted to owner automatically. If there are
                      already other owners, you can leave without transferring anything. You can return only if invited.
                    </p>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={leaving}>Cancel</AlertDialogCancel>
              <button
                type="button"
                disabled={leaving}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground ring-offset-background transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                onClick={() => void onConfirmLeave()}
              >
                {leaving ? <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden /> : null}
                Leave
              </button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
