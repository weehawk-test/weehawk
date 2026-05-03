"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Loader2, UserPlus } from "lucide-react";
import type { OrganizationMemberPublic } from "@/lib/organizations-types";
import { addOrganizationMember } from "@/lib/organizations-api";
import { useOrgWorkspace } from "../../org-workspace-context";
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
  const [members, setMembers] = useState(initialMembers);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const canInvite = org.isOwner;

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
    if (!canInvite) return;
    setError(null);
    setAdding(true);
    try {
      const row = await addOrganizationMember(organizationPublicId, email);
      setMembers((prev) => {
        const exists = prev.some((m) => m.email.toLowerCase() === row.email.toLowerCase());
        if (exists) return prev.map((m) => (m.email.toLowerCase() === row.email.toLowerCase() ? row : m));
        return [...prev, row].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
      });
      resetInviteForm();
      setInviteOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add member");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">{intro}</div>
        {canInvite ? (
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
                    Enter the teammate&apos;s Weehawk account email. They must sign up before you can add them.
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
                      Add member
                    </button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        ) : null}
      </div>
      {!canInvite ? (
        <p className="text-sm text-muted-foreground">
          Only the organization owner can invite new members. Contact the owner if you need access for someone else.
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
                <th className="px-4 py-3">Role</th>
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
                    {m.isOwner ? (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                        Owner
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Member</span>
                    )}
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
