"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Loader2, UserPlus } from "lucide-react";
import type { OrganizationMemberPublic } from "@/lib/organizations-types";
import { inviteOrganizationMember, setOrganizationMemberRole } from "@/lib/organizations-api";
import { useOrgWorkspace } from "@/(platform)/org-workspace/org-workspace-context";
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

export function OrgMembersClient({
  organizationPublicId,
  initialMembers,
  intro,
}: {
  organizationPublicId: string;
  initialMembers: OrganizationMemberPublic[];
  intro: ReactNode;
}) {
  const org = useOrgWorkspace();
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [members, setMembers] = useState(initialMembers);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleUpdatingEmail, setRoleUpdatingEmail] = useState<string | null>(null);

  /** Invites and role changes are owner-only (Members tab may still be visible for delegates). */
  const canManageMembers = org.isOwner;

  useEffect(() => {
    setMembers(initialMembers);
  }, [initialMembers]);

  const resetInviteForm = () => {
    setEmail("");
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
    setAdding(true);
    try {
      const { message, notice } = await inviteOrganizationMember(organizationPublicId, email);
      resetInviteForm();
      setInviteOpen(false);
      router.refresh();
      toast({
        title: notice ? "Request recorded" : "Invitation sent",
        description: notice ?? message,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send invitation");
    } finally {
      setAdding(false);
    }
  };

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
      const { message } = await setOrganizationMemberRole(organizationPublicId, member.email, nextRole);
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

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">{intro}</div>
        {canManageMembers ? (
          <div className="shrink-0">
            <Dialog open={inviteOpen} onOpenChange={onOpenChange}>
              <DialogTrigger asChild>
                <button type="button" className="btn-primary inline-flex shrink-0 items-center justify-center gap-2">
                  <UserPlus className="size-4" aria-hidden />
                  Invite member
                </button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Invite member</DialogTitle>
                  <DialogDescription>
                    Enter their email. If they already have a Weehawk account, they&apos;ll get a link to accept the
                    invite (they should open it while signed in with that address).
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
                      Send invitation
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
                    {canManageMembers ? (
                      <select
                        key={`${m.email}-${m.isOwner}`}
                        className="input-field w-full max-w-[11rem] py-1.5 text-xs"
                        aria-label={`Role for ${m.email}`}
                        value={m.isOwner ? "owner" : "member"}
                        disabled={
                          roleUpdatingEmail === m.email ||
                          Boolean(roleUpdatingEmail && roleUpdatingEmail !== m.email)
                        }
                        title={
                          m.isOwner
                            ? "Change to Member to step down (another owner must remain)."
                            : undefined
                        }
                        onChange={(ev) => {
                          const v = ev.target.value as "member" | "owner";
                          void onRoleChange(m, v);
                        }}
                      >
                        <option value="member">Member</option>
                        <option value="owner">Owner</option>
                      </select>
                    ) : m.isOwner ? (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                        Owner
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Member</span>
                    )}
                    {roleUpdatingEmail === m.email ? (
                      <Loader2 className="ml-2 inline size-4 animate-spin text-muted-foreground align-middle" aria-hidden />
                    ) : null}
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
