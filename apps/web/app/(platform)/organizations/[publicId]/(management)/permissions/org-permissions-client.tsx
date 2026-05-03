"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2 } from "lucide-react";
import type { OrganizationMemberPublic } from "@/lib/organizations-types";
import { setMemberWorkspacePermissions } from "@/lib/organizations-api";
import {
  ORG_WORKSPACE_PERMISSION_LABELS,
  ORG_WORKSPACE_PERMISSIONS,
  ORG_WORKSPACE_PERMISSION_TABLE_PRIMARY_KEYS,
  ORG_WORKSPACE_REMOTE_ADVANCED_KEYS,
  ORG_WORKSPACE_REMOTE_ADVANCED_LABELS,
  type OrgWorkspacePermissionKey,
} from "@/lib/org-workspace-permissions";
import { useOrgWorkspace } from "../../org-workspace-context";
import { useToast } from "@/hooks/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Same top band in every permission cell so main checkboxes line up across columns. */
const PERM_CHECKBOX_ROW_CLASS = "flex h-9 shrink-0 items-center justify-center gap-1";

export function OrgPermissionsClient({
  organizationPublicId,
  initialMembers,
}: {
  organizationPublicId: string;
  initialMembers: OrganizationMemberPublic[];
}) {
  const org = useOrgWorkspace();
  const router = useRouter();
  const { toast } = useToast();
  const [members, setMembers] = useState(initialMembers);
  const [busy, setBusy] = useState<{ email: string; key: OrgWorkspacePermissionKey } | null>(null);

  const canEdit = org.isOwner;

  useEffect(() => {
    setMembers(initialMembers);
  }, [initialMembers]);

  const onToggle = async (
    member: OrganizationMemberPublic,
    key: OrgWorkspacePermissionKey,
    allowed: boolean,
  ) => {
    if (!canEdit || member.isOwner || busy) return;
    setBusy({ email: member.email, key });
    try {
      await setMemberWorkspacePermissions(organizationPublicId, member.email, {
        [key]: allowed,
      });
      setMembers((prev) =>
        prev.map((m) =>
          m.email === member.email
            ? {
                ...m,
                workspacePermissions: { ...m.workspacePermissions, [key]: allowed },
              }
            : m,
        ),
      );
      toast({
        title: "Permissions updated",
        description: `${member.email}: ${ORG_WORKSPACE_PERMISSION_LABELS[key]} ${allowed ? "allowed" : "blocked"}.`,
      });
      router.refresh();
    } catch (err) {
      toast({
        title: "Could not update permissions",
        description: err instanceof Error ? err.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Control which workspace areas each <strong>member</strong> can use in this organization. Owners always have
        full access. Turning off an area hides it in the sidebar and blocks the related API calls for that member.
        Under <strong>Servers</strong>, open <strong>Advanced</strong> to adjust Terminal or Docker Manager without
        changing host management.
      </p>
      {!canEdit ? (
        <p className="text-sm text-amber-700 dark:text-amber-400/90">
          Only organization owners can change permissions. You can view the matrix below.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-border/80 bg-card/30">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-muted/50 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2">Member</th>
              {ORG_WORKSPACE_PERMISSION_TABLE_PRIMARY_KEYS.map((key) => (
                <th key={key} className="px-2 py-2 text-center font-medium normal-case">
                  {key === ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER ? (
                    <span className="inline-block max-w-[7rem] leading-tight">
                      {ORG_WORKSPACE_PERMISSION_LABELS[key]}
                    </span>
                  ) : (
                    <span className="inline-block max-w-[6.5rem] leading-tight">
                      {ORG_WORKSPACE_PERMISSION_LABELS[key]}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/80">
            {members.map((m) => (
              <tr key={m.email} className="hover:bg-muted/20">
                <td className="sticky left-0 z-10 bg-card/40 px-3 py-1.5 backdrop-blur-sm">
                  <div className="font-medium text-foreground">
                    {`${m.firstName} ${m.lastName}`.trim() || m.email}
                  </div>
                  <div className="text-xs text-muted-foreground">{m.email}</div>
                  {m.isOwner ? (
                    <span className="mt-1 inline-block rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                      Owner
                    </span>
                  ) : null}
                </td>
                {ORG_WORKSPACE_PERMISSION_TABLE_PRIMARY_KEYS.map((key) => {
                  if (key === ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER) {
                    const remoteAllowed = m.workspacePermissions[ORG_WORKSPACE_PERMISSIONS.REMOTE_SERVER];
                    const disabled = !canEdit || m.isOwner;
                    return (
                      <td key={key} className="px-2 py-1.5 align-top text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <div className={PERM_CHECKBOX_ROW_CLASS}>
                            <label className="inline-flex cursor-pointer items-center gap-1">
                              <input
                                type="checkbox"
                                className="size-4 rounded border-border accent-primary disabled:opacity-50"
                                checked={remoteAllowed}
                                disabled={disabled}
                                onChange={(ev) => {
                                  void onToggle(m, key, ev.target.checked);
                                }}
                              />
                              {busy?.email === m.email && busy.key === key ? (
                                <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
                              ) : null}
                            </label>
                          </div>
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                disabled={m.isOwner}
                                className="inline-flex items-center justify-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                              >
                                Advanced
                                <ChevronDown className="size-3 shrink-0 opacity-70" aria-hidden />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto min-w-[13rem] p-2.5" align="center" sideOffset={6}>
                              <p className="mb-2 border-b border-border/60 pb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                Server access
                              </p>
                              <div className="space-y-1.5">
                                {ORG_WORKSPACE_REMOTE_ADVANCED_KEYS.map((subKey) => {
                                  const subAllowed = m.workspacePermissions[subKey];
                                  const subDisabled =
                                    disabled || !remoteAllowed || busy?.email === m.email;
                                  const subBusy = busy?.email === m.email && busy.key === subKey;
                                  return (
                                    <label
                                      key={subKey}
                                      className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border/50 bg-muted/15 px-2 py-1.5 text-xs"
                                    >
                                      <span className="text-foreground">
                                        {ORG_WORKSPACE_REMOTE_ADVANCED_LABELS[subKey]}
                                      </span>
                                      <span className="inline-flex items-center gap-0.5">
                                        <input
                                          type="checkbox"
                                          className="size-3.5 rounded border-border accent-primary disabled:opacity-50"
                                          checked={subAllowed}
                                          disabled={subDisabled}
                                          onChange={(ev) => {
                                            void onToggle(m, subKey, ev.target.checked);
                                          }}
                                        />
                                        {subBusy ? (
                                          <Loader2
                                            className="size-3.5 animate-spin text-muted-foreground"
                                            aria-hidden
                                          />
                                        ) : null}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            </PopoverContent>
                          </Popover>
                        </div>
                      </td>
                    );
                  }

                  const allowed = m.workspacePermissions[key];
                  const isBusy = busy?.email === m.email && busy.key === key;
                  const disabled = !canEdit || m.isOwner;
                  return (
                    <td key={key} className="px-2 py-1.5 text-center align-top">
                      <div className={PERM_CHECKBOX_ROW_CLASS}>
                        <label className="inline-flex cursor-pointer items-center gap-1">
                          <input
                            type="checkbox"
                            className="size-4 rounded border-border accent-primary disabled:opacity-50"
                            checked={allowed}
                            disabled={disabled}
                            onChange={(ev) => {
                              void onToggle(m, key, ev.target.checked);
                            }}
                          />
                          {isBusy ? (
                            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
                          ) : null}
                        </label>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
