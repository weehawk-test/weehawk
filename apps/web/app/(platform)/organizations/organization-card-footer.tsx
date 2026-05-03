"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronRight, Clock, Loader2, UserMinus } from "lucide-react";
import { leaveOrganization } from "@/lib/organizations-api";
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

export function OrganizationCardFooter({
  publicId,
  name,
  dateLabel,
  dateTitle,
  isOwner,
}: {
  publicId: string;
  name: string;
  dateLabel: string;
  dateTitle: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const handleConfirmLeave = async () => {
    if (isOwner || leaving) return;
    setLeaving(true);
    try {
      const { message } = await leaveOrganization(publicId);
      toast({ title: "Left organization", description: message });
      setConfirmOpen(false);
      router.refresh();
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

  return (
    <div className="mt-auto pt-4 border-t border-slate-200 text-xs text-muted-foreground dark:border-white/5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 min-w-0" title={dateTitle}>
          <Clock className="w-3 h-3 shrink-0" aria-hidden />
          <span className="truncate">{dateLabel}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {!isOwner ? (
            <>
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                className="text-red-600 hover:text-red-700 hover:underline dark:text-red-400 dark:hover:text-red-300 font-medium inline-flex items-center gap-1"
              >
                Leave
                <UserMinus className="w-3 h-3 shrink-0" aria-hidden />
              </button>
              <AlertDialog
                open={confirmOpen}
                onOpenChange={(open) => {
                  if (!leaving) setConfirmOpen(open);
                }}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Leave this organization?</AlertDialogTitle>
                    <AlertDialogDescription>
                      You will lose access to <span className="font-medium text-foreground">{name}</span> until
                      someone invites you again.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={leaving}>Cancel</AlertDialogCancel>
                    <button
                      type="button"
                      disabled={leaving}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground ring-offset-background transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                      onClick={() => void handleConfirmLeave()}
                    >
                      {leaving ? <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden /> : null}
                      Leave organization
                    </button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : null}
          <Link
            href={`/organizations/${encodeURIComponent(publicId)}/projects`}
            className="text-primary hover:underline font-medium inline-flex items-center gap-1"
          >
            View
            <ChevronRight className="w-3 h-3" aria-hidden />
          </Link>
        </div>
    </div>
  );
}
