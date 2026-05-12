"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Loader2, UserPlus } from "lucide-react";
import type { OrganizationMemberPublic } from "@/lib/organizations-types";
import {
  inviteOrganizationMember,
  removeOrganizationMember,
  setOrganizationMemberRole,
} from "@/lib/organizations-api";
import { fetchNotificationChannels, type NotificationChannel } from "@/lib/notifications-api";
import { fetchRemoteServers, type RemoteServerRow } from "@/lib/remote-servers-api";
import { filterSshDeployServers } from "@/lib/loopback-ssh-host";
import { useOrgWorkspace } from "@/(platform)/org-workspace/org-workspace-context";
import { useAuth } from "@/contexts/auth-context";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const isSelfHosted =
  (process.env.NEXT_PUBLIC_INSTANCE_MODE || "cloud").trim().toLowerCase() === "self-hosted";

export function OrgMembersClient({
  activeOrgPublicId,
  initialMembers,
  intro,
}: {
  activeOrgPublicId: string;
  initialMembers: OrganizationMemberPublic[];
  intro: ReactNode;
}) {
  const org = useOrgWorkspace();
  const router = useRouter();
  const { toast } = useToast();
  const { accessToken, user } = useAuth();
  const confirm = useConfirm();
  const [members, setMembers] = useState(initialMembers);
  const [email, setEmail] = useState("");
  const [notificationChannelId, setNotificationChannelId] = useState("");
  const [notificationChannels, setNotificationChannels] = useState<NotificationChannel[]>([]);
  const [loadingNotificationChannels, setLoadingNotificationChannels] = useState(false);
  const [notificationRemoteServerId, setNotificationRemoteServerId] = useState("");
  const [deployServers, setDeployServers] = useState<RemoteServerRow[]>([]);
  const [loadingDeployServers, setLoadingDeployServers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleUpdatingEmail, setRoleUpdatingEmail] = useState<string | null>(null);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);

  /** Invites and role changes are owner-only (Members tab may still be visible for delegates). */
  const canManageMembers = org.isOwner;

  useEffect(() => {
    setMembers(initialMembers);
  }, [initialMembers]);

  const resetInviteForm = () => {
    setEmail("");
    setNotificationChannelId("");
    setNotificationRemoteServerId("");
    setError(null);
  };

  const onOpenChange = (open: boolean) => {
    setInviteOpen(open);
    if (!open) resetInviteForm();
  };

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageMembers) return;
    setError(null);
    if (isSelfHosted && !notificationChannelId.trim()) {
      setError("Notification channel is required in self-hosted mode.");
      return;
    }
    if (isSelfHosted && !notificationRemoteServerId.trim()) {
      setError("Deploy server is required in self-hosted mode.");
      return;
    }
    setAdding(true);
    try {
      const { message, notice } = await inviteOrganizationMember(
        activeOrgPublicId,
        email,
        notificationChannelId,
        notificationRemoteServerId ? Number(notificationRemoteServerId) : undefined,
      );
      resetInviteForm();
      setInviteOpen(false);
      router.refresh();
      toast({
        title: notice ? "Request recorded" : isSelfHosted ? "Member added" : "Invitation sent",
        description: notice ?? message,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send invitation");
    } finally {
      setAdding(false);
    }
  };

  useEffect(() => {
    if (!inviteOpen || !isSelfHosted || !accessToken) return;
    let cancelled = false;
    setLoadingNotificationChannels(true);
    void fetchNotificationChannels(accessToken)
      .then((rows) => {
        if (cancelled) return;
        setNotificationChannels(rows);
      })
      .catch(() => {
        if (!cancelled) setNotificationChannels([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingNotificationChannels(false);
      });
    return () => {
      cancelled = true;
    };
  }, [inviteOpen, accessToken]);

  useEffect(() => {
    if (!inviteOpen || !isSelfHosted || !accessToken) return;
    let cancelled = false;
    setLoadingDeployServers(true);
    void fetchRemoteServers(accessToken)
      .then((rows) => {
        if (cancelled) return;
        setDeployServers(filterSshDeployServers(rows));
      })
      .catch(() => {
        if (!cancelled) setDeployServers([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingDeployServers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [inviteOpen, accessToken]);

  const onRoleChange = async (member: OrganizationMemberPublic, nextRole: "member" | "owner") => {
    if (!canManageMembers || roleUpdatingEmail) return;
    const isOwner = member.isOwner;
    if ((isOwner && nextRole === "owner") || (!isOwner && nextRole === "member")) return;

    const label = `${member.firstName} ${member.lastName}`.trim() || member.email;

    if (nextRole === "owner") {
      const ok = await confirm({
        title: "Add organization owner?",
        description: `${label} will have the same admin access as other owners (invites, member roles).`,
        confirmLabel: "Make owner",
      });
      if (!ok) return;
    } else {
      const ok = await confirm({
        title: "Remove owner role?",
        description: `${label} will become a regular member. There must always be at least one owner.`,
        confirmLabel: "Make member",
        variant: "destructive",
      });
      if (!ok) return;
    }

    setRoleUpdatingEmail(member.email);
    try {
      const { message } = await setOrganizationMemberRole(activeOrgPublicId, member.email, nextRole);
      toast({ title: "Role updated", description: message });
      router.refresh();
    } catch (err) {
      toast({
        title: "Could not update role",
        description: err instanceof Error ? err.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setRoleUpdatingEmail(null);
    }
  };

  const onRemoveMember = async (member: OrganizationMemberPublic) => {
    if (!canManageMembers || removingEmail || roleUpdatingEmail) return;
    const label = `${member.firstName} ${member.lastName}`.trim() || member.email;
    const ok = await confirm({
      title: member.isOwner ? "Remove owner from organization?" : "Remove member from organization?",
      description: member.isOwner
        ? `${label} will lose access to this organization. You cannot remove the last owner.`
        : `${label} will lose access to this organization immediately.`,
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!ok) return;

    setRemovingEmail(member.email);
    try {
      const { message } = await removeOrganizationMember(activeOrgPublicId, member.email);
      toast({ title: "Member removed", description: message });
      router.refresh();
    } catch (err) {
      toast({
        title: "Could not remove member",
        description: err instanceof Error ? err.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setRemovingEmail(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">{intro}</div>
        {canManageMembers ? (
          <div className="shrink-0">
            <Dialog open={inviteOpen} onOpenChange={onOpenChange}>
              <DialogTrigger asChild>
                <button type="button" className="btn-primary inline-flex shrink-0 items-center justify-center gap-2 h-9 text-sm">
                  <UserPlus className="size-4" aria-hidden />
                  Invite member
                </button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>{isSelfHosted ? "Add member" : "Invite member"}</DialogTitle>
                  <DialogDescription>
                    {isSelfHosted
                      ? "Enter their email. If they don\u2019t have an account yet, one will be created automatically and they\u2019ll be added to this organization."
                      : "Enter their email. If they already have a Weehawk account, they\u2019ll get a link to accept the invite (they should open it while signed in with that address)."}
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={onAdd} className="space-y-4">
                  <div>
                    <label htmlFor="invite-email" className="sr-only">
                      Email
                    </label>
                    <input
                      id="invite-email"
                      type="email"
                      autoComplete="email"
                      placeholder="colleague@company.com"
                      value={email}
                      onChange={(ev) => setEmail(ev.target.value)}
                      className="input-field w-full"
                      required
                      disabled={adding}
                    />
                  </div>
                  {isSelfHosted ? (
                    <div className="space-y-1.5">
                      <label htmlFor="invite-deploy-server" className="text-sm text-muted-foreground">
                        Deploy server for notification
                      </label>
                      <select
                        id="invite-deploy-server"
                        value={notificationRemoteServerId}
                        onChange={(ev) => setNotificationRemoteServerId(ev.target.value)}
                        className="input-field w-full"
                        required
                        disabled={adding || loadingDeployServers}
                      >
                        <option value="" disabled>
                          Select a deploy server...
                        </option>
                        {deployServers.map((srv) => (
                          <option key={srv.id} value={String(srv.id)}>
                            {srv.name} ({srv.host})
                          </option>
                        ))}
                      </select>
                      <label htmlFor="invite-channel" className="text-sm text-muted-foreground">
                        Notification channel
                      </label>
                      <select
                        id="invite-channel"
                        value={notificationChannelId}
                        onChange={(ev) => setNotificationChannelId(ev.target.value)}
                        className="input-field w-full"
                        required
                        disabled={adding || loadingNotificationChannels}
                      >
                        <option value="" disabled>
                          Select a notification channel...
                        </option>
                        {notificationChannels.map((ch) => (
                          <option key={ch.publicId ?? ch.id} value={ch.publicId ?? String(ch.id)}>
                            {ch.name} ({ch.type})
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-muted-foreground">
                        Weehawk sends join details with site link and temporary credentials.
                      </p>
                    </div>
                  ) : null}
                  {error ? (
                    <p className="text-sm text-destructive" role="alert">
                      {error}
                    </p>
                  ) : null}
                  <DialogFooter className="gap-2 sm:gap-0">
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={adding}
                      onClick={() => onOpenChange(false)}
                    >
                      Cancel
                    </button>
                    <button type="submit" disabled={adding} className="btn-primary inline-flex items-center justify-center gap-2">
                      {adding ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <UserPlus className="size-4" aria-hidden />}
                      {isSelfHosted ? "Add member" : "Send invitation"}
                    </button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        ) : null}
      </div>
      {!canManageMembers ? (
        <p className="text-sm text-amber-700 dark:text-amber-400/90">
          Only organization owners can invite members or change roles. Contact an owner if you need someone added or
          promoted.
        </p>
      ) : null}

      <div>
        <h3 className="mb-3 text-lg font-semibold text-foreground">Members ({members.length})</h3>
        <div className="overflow-hidden rounded-2xl border border-border/80">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3 min-w-[8.5rem]">Role</th>
                <th className="hidden px-4 py-3 sm:table-cell">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/80 bg-card/30">
              {members.map((m) => (
                <tr key={m.email} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium text-foreground">
                    {m.firstName} {m.lastName}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{m.email}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {m.isOwner ? (
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                          Owner
                        </span>
                      ) : canManageMembers ? (
                        <select
                          key={`${m.email}-${m.isOwner}`}
                          className="input-field w-full max-w-[11rem] py-1.5 text-xs"
                          aria-label={`Role for ${m.email}`}
                          value="member"
                          disabled={
                            roleUpdatingEmail === m.email ||
                            removingEmail === m.email ||
                            Boolean(roleUpdatingEmail && roleUpdatingEmail !== m.email) ||
                            Boolean(removingEmail && removingEmail !== m.email)
                          }
                          onChange={(ev) => {
                            const v = ev.target.value as "member" | "owner";
                            void onRoleChange(m, v);
                          }}
                        >
                          <option value="member">Member</option>
                          <option value="owner">Owner</option>
                        </select>
                      ) : (
                        <span className="text-muted-foreground">Member</span>
                      )}
                      {canManageMembers &&
                      user?.email?.toLowerCase() !== m.email.toLowerCase() ? (
                        <button
                          type="button"
                          className="btn-secondary h-7 px-2 text-xs text-destructive hover:text-destructive"
                          disabled={
                            roleUpdatingEmail === m.email ||
                            removingEmail === m.email ||
                            Boolean(roleUpdatingEmail && roleUpdatingEmail !== m.email) ||
                            Boolean(removingEmail && removingEmail !== m.email)
                          }
                          onClick={() => {
                            void onRemoveMember(m);
                          }}
                        >
                          Remove
                        </button>
                      ) : null}
                      {roleUpdatingEmail === m.email || removingEmail === m.email ? (
                        <Loader2 className="inline size-4 animate-spin text-muted-foreground" aria-hidden />
                      ) : null}
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                    {new Date(m.joinedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
