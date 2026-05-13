"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2, LogOut, Pencil, Plus } from "lucide-react";
import { useAuth, type AuthUser } from "@/contexts/auth-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  clearActiveOrganizationPublicId,
  setActiveOrganizationPublicId,
  fetchOrganizations,
  leaveOrganization,
  notifyOrganizationsListChanged,
  updateOrganization,
  ORGANIZATIONS_LIST_CHANGED_EVENT,
} from "@/lib/organizations-api";
import { pickDefaultWorkspaceOrganization } from "@/lib/pick-primary-owned-org";
import type { OrganizationPublic } from "@/lib/organizations-types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/** Always land on the workspace start page after switching organization. */
function targetPathAfterOrgSwitch(): string {
  return "/home";
}

type WorkspaceSwitcherProps = {
  /** Current organization name (shown under “Weehawk” when that org is active). */
  currentLabel?: string;
  /** Active organization public id, or null on global pages (e.g. profile, docker console). */
  activeOrgPublicId?: string | null;
  onNavigate?: () => void;
  className?: string;
};

/** Same initials logic as sidebar profile avatar */
function userDisplayAndInitials(user: AuthUser) {
  const nameParts = [user.firstName?.trim(), user.lastName?.trim()].filter(Boolean);
  const displayName = nameParts.length > 0 ? nameParts.join(" ") : user.email ?? "Weehawk User";
  const initials =
    displayName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "WU";
  return { displayName, initials };
}

function initialsFromOrgName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/** Matches `Sidebar` / `OrganizationSidebar` profile avatar shell */
function WorkspaceRowAvatar({
  imageUrl,
  initials,
  alt,
}: {
  imageUrl?: string | null;
  initials: string;
  alt: string;
}) {
  const src = imageUrl?.trim() || null;
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-gradient-to-br from-primary/20 to-muted/40">
      {src ? (
        // User avatars are external URLs (e.g. Google); same pattern as sidebar profile.
        // eslint-disable-next-line @next/next/no-img-element -- remote profile URLs, not in `next/image` domains
        <img src={src} alt={alt} className="h-full w-full rounded-xl object-cover" referrerPolicy="no-referrer" />
      ) : (
        <span className="text-xs font-bold tracking-tight text-primary">{initials}</span>
      )}
    </div>
  );
}

const menuItemClass =
  "cursor-pointer rounded-lg px-2 py-0 mx-1.5 my-0 focus:bg-accent/80 data-[highlighted]:bg-accent/80";

const rowLinkClass =
  "flex w-full min-w-0 items-center gap-2 py-1.5 pl-2 pr-1.5 text-left no-underline outline-none";

export function WorkspaceSwitcher({
  currentLabel = "",
  activeOrgPublicId,
  onNavigate,
  className,
}: WorkspaceSwitcherProps) {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [orgs, setOrgs] = useState<OrganizationPublic[]>([]);
  const [pendingOrgPublicId, setPendingOrgPublicId] = useState("");
  const [pendingOrgLabel, setPendingOrgLabel] = useState("");

  const [editNameOpen, setEditNameOpen] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const effectiveActiveOrgPublicId =
    pendingOrgPublicId ||
    (activeOrgPublicId != null && activeOrgPublicId.trim() !== ""
      ? activeOrgPublicId.trim()
      : "");

  const selectOrganization = (publicId: string) => {
    const nextId = publicId.trim();
    const nextOrg = orgs.find((o) => o.publicId === nextId) ?? null;
    setPendingOrgPublicId(nextId);
    setPendingOrgLabel(nextOrg?.name?.trim() ?? "");
    void setActiveOrganizationPublicId(nextId).catch(() => undefined);
    /** Drop cached lists/details so UI cannot show the previous org’s data while RSC refreshes. */
    queryClient.clear();
    onNavigate?.();
    const next = targetPathAfterOrgSwitch();
    const runNav = () => {
      if (next !== pathname) {
        router.push(next);
        queueMicrotask(() => {
          void router.refresh();
        });
      } else {
        router.refresh();
      }
    };
    /** Next tick: active org API call starts before refresh/navigation requests. */
    queueMicrotask(runNav);
  };

  const accountHint = useMemo(() => {
    if (!user) return "Account";
    if (pathname === "/profile" || pathname.startsWith("/profile/")) return "Account";
    const { displayName } = userDisplayAndInitials(user);
    return displayName;
  }, [user, pathname]);

  const activeOrgLabel = useMemo(() => {
    if (pendingOrgPublicId && pendingOrgLabel) return pendingOrgLabel;
    const propId = activeOrgPublicId?.trim() ?? "";
    const propLabel = currentLabel.trim();
    if (
      propId &&
      propLabel &&
      effectiveActiveOrgPublicId !== "" &&
      propId === effectiveActiveOrgPublicId
    ) {
      return propLabel;
    }
    if (!effectiveActiveOrgPublicId) return "";
    return orgs.find((o) => o.publicId === effectiveActiveOrgPublicId)?.name?.trim() ?? "";
  }, [
    pendingOrgPublicId,
    pendingOrgLabel,
    activeOrgPublicId,
    currentLabel,
    effectiveActiveOrgPublicId,
    orgs,
  ]);

  useEffect(() => {
    if (!pendingOrgPublicId) return;
    const propOrg = activeOrgPublicId?.trim() ?? "";
    if (pendingOrgPublicId === propOrg) {
      setPendingOrgPublicId("");
      setPendingOrgLabel("");
    }
  }, [pendingOrgPublicId, activeOrgPublicId, pathname]);

  useEffect(() => {
    if (!user?.userId) {
      queueMicrotask(() => setOrgs([]));
      return;
    }
    let cancelled = false;
    const load = () => {
      void fetchOrganizations()
        .then((list) => {
          if (!cancelled) setOrgs(list);
        })
        .catch(() => {
          if (!cancelled) setOrgs([]);
        });
    };
    load();
    const onListChanged = () => load();
    window.addEventListener(ORGANIZATIONS_LIST_CHANGED_EVENT, onListChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(ORGANIZATIONS_LIST_CHANGED_EVENT, onListChanged);
    };
  }, [user?.userId]);

  const activeOrg = orgs.find((o) => o.publicId === effectiveActiveOrgPublicId) ?? null;

  const openEditName = () => {
    if (!activeOrg) return;
    setEditNameValue(activeOrg.name);
    setEditNameOpen(true);
  };

  const onSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrg || savingName || editNameValue.trim() === activeOrg.name.trim()) return;
    setSavingName(true);
    try {
      await updateOrganization(activeOrg.publicId, { name: editNameValue.trim() });
      toast({ title: "Organization updated", description: "Name saved." });
      notifyOrganizationsListChanged();
      setEditNameOpen(false);
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
    if (!activeOrg || leaving) return;
    setLeaving(true);
    try {
      const { message } = await leaveOrganization(activeOrg.publicId);
      toast({ title: "Left organization", description: message });
      setLeaveOpen(false);
      const remaining = await fetchOrganizations();
      const next = pickDefaultWorkspaceOrganization(remaining);
      queryClient.clear();
      notifyOrganizationsListChanged();
      if (next?.publicId?.trim()) {
        await setActiveOrganizationPublicId(next.publicId);
        queueMicrotask(() => {
          router.push("/home");
          router.refresh();
        });
      } else {
        await clearActiveOrganizationPublicId();
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

  const triggerLabel = activeOrgLabel || accountHint;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex min-h-0 min-w-0 w-full max-w-full flex-col items-stretch rounded-xl px-1 py-0.5 text-left -mx-1",
            "outline-none transition-colors hover:bg-accent/60 data-[state=open]:bg-accent/60",
            /** Avoid `focus-visible:bg-*`: Radix returns focus to the trigger on close, which looked stuck “hovered”. */
            "focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:ring-offset-0",
            className,
          )}
          aria-label="Workspace and organizations"
          aria-haspopup="menu"
        >
          <span className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-left text-lg font-bold tracking-tight leading-none text-foreground">
              Weehawk
            </span>
            <ChevronsUpDown
              className="size-3.5 shrink-0 translate-y-0.5 text-foreground"
              aria-hidden
            />
          </span>
          <span
            className="mt-1 block min-w-0 truncate text-left font-mono text-[10px] tracking-widest text-muted-foreground"
            title={triggerLabel}
          >
            {triggerLabel}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className={cn(
          "min-w-[15.5rem] max-w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border/80 bg-popover p-0 py-2 shadow-xl",
          "dark:border-border/60 dark:bg-zinc-950/98 dark:shadow-black/40",
        )}
      >
        <DropdownMenuLabel className="px-3 pb-1.5 pt-0 text-[11px] font-normal uppercase tracking-wider text-muted-foreground">
          Organizations
        </DropdownMenuLabel>

        <div className="px-0">
          {orgs.map((o) => {
            const active = o.publicId === effectiveActiveOrgPublicId;
            const orgInitials = initialsFromOrgName(o.name);
            return (
              <DropdownMenuItem
                key={o.publicId}
                className={menuItemClass}
                onSelect={() => {
                  if (!active) selectOrganization(o.publicId);
                }}
              >
                <div className={rowLinkClass}>
                  <WorkspaceRowAvatar imageUrl={null} initials={orgInitials} alt={o.name} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{o.name}</div>
                    <div
                      className="truncate font-mono text-[10px] leading-tight tracking-wide text-muted-foreground"
                      title={o.publicId}
                    >
                      {o.publicId}
                    </div>
                  </div>
                  {active ? (
                    <span className="flex shrink-0 items-center gap-1">
                      {o.isOwner ? (
                        <button
                          type="button"
                          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          aria-label="Edit name"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditName();
                          }}
                        >
                          <Pencil className="size-3.5" strokeWidth={2} aria-hidden />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        aria-label="Leave organization"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLeaveOpen(true);
                        }}
                      >
                        <LogOut className="size-3.5" strokeWidth={2} aria-hidden />
                      </button>
                      <Check
                        className="size-4 -translate-x-0.5 text-foreground"
                        strokeWidth={2.25}
                        aria-hidden
                      />
                    </span>
                  ) : null}
                </div>
              </DropdownMenuItem>
            );
          })}
        </div>

        <DropdownMenuSeparator className="my-1.5 bg-border/70 dark:bg-border/50" />

        <DropdownMenuItem asChild className={cn(menuItemClass, "mt-0")}>
          <Link
            href="/organizations/create"
            scroll={false}
            onClick={onNavigate}
            className={cn(rowLinkClass, "text-muted-foreground hover:text-foreground")}
          >
            <Plus className="size-4 shrink-0 opacity-80" strokeWidth={2} aria-hidden />
            <span className="text-sm font-medium">Create organization</span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>

      <Dialog open={editNameOpen} onOpenChange={(open) => !savingName && setEditNameOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit organization name</DialogTitle>
            <DialogDescription>Visible to all members in this organization.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void onSaveName(e)} className="space-y-4">
            <input
              type="text"
              value={editNameValue}
              onChange={(e) => setEditNameValue(e.target.value)}
              maxLength={200}
              className="input-field w-full"
              autoComplete="organization"
              disabled={savingName}
              autoFocus
            />
            <DialogFooter className="gap-2 sm:gap-0">
              <button
                type="button"
                className="btn-secondary"
                disabled={savingName}
                onClick={() => setEditNameOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingName || !editNameValue.trim() || editNameValue.trim() === activeOrg?.name.trim()}
                className="btn-primary inline-flex items-center justify-center gap-2"
              >
                {savingName ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Save
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={leaveOpen} onOpenChange={(open) => !leaving && setLeaveOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave this organization?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {activeOrg && !activeOrg.isOwner ? (
                  <p>
                    You will lose access until someone invites you back to{" "}
                    <span className="font-medium text-foreground">{activeOrg.name}</span>.
                  </p>
                ) : activeOrg && activeOrg.memberCount <= 1 ? (
                  <p>
                    You are the only member. Leaving will close this organization and{" "}
                    <span className="font-medium text-foreground">permanently delete all of its workspace data</span>.
                    This cannot be undone.
                  </p>
                ) : (
                  <p>
                    If you are the only owner, another member will be promoted automatically. You can return only if
                    invited.
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
    </DropdownMenu>
  );
}
