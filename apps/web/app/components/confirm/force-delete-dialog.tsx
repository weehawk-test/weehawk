"use client";

import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { OctagonAlert, Loader2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ForceDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  onConfirm: () => void;
  /** Disables Cancel and Confirm while a force-delete request is in flight */
  pending?: boolean;
};

/** Same shell as `AlertDialogContent` + amber border, but `Dialog` so overlay click dismisses. */
export function ForceDeleteDialog({
  open,
  onOpenChange,
  title,
  children,
  onConfirm,
  pending = false,
}: ForceDeleteDialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-[120] bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-[50%] top-[50%] z-[120] grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border border-amber-500/20 bg-background p-6 text-foreground shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
          )}
        >
          <div className="flex flex-col space-y-2 text-center sm:text-left">
            <DialogPrimitive.Title className="flex items-center justify-center gap-2 text-lg font-semibold text-amber-500 sm:justify-start">
              <OctagonAlert className="h-5 w-5 shrink-0" aria-hidden />
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description asChild>
              <div className="text-sm text-muted-foreground">{children}</div>
            </DialogPrimitive.Description>
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
            <button
              type="button"
              className={cn(buttonVariants({ variant: "outline" }), "mt-2 sm:mt-0")}
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              className={cn(buttonVariants({ variant: "destructive" }), "gap-2")}
              onClick={onConfirm}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Confirm force delete
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
