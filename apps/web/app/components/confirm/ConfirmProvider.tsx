"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive styling for delete / irreversible actions */
  variant?: "default" | "destructive";
};

type Resolver = (value: boolean) => void;

const ConfirmContext = createContext<
  ((opts: ConfirmOptions) => Promise<boolean>) | null
>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<Resolver | null>(null);
  const settledRef = useRef(false);

  const finish = useCallback((value: boolean) => {
    if (settledRef.current) return;
    settledRef.current = true;
    resolverRef.current?.(value);
    resolverRef.current = null;
    setOpen(false);
    setOptions(null);
  }, []);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      settledRef.current = false;
      setOptions(opts);
      resolverRef.current = resolve;
      setOpen(true);
    });
  }, []);

  const handleOpenChange = (next: boolean) => {
    if (!next) finish(false);
  };

  const destructive = options?.variant === "destructive";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className={cn(
              "fixed inset-0 z-[120] bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            )}
          />
          <DialogPrimitive.Content
            className={cn(
              // Match `AlertDialogContent` defaults merged with the old confirm overrides:
              // shadcn adds gap-4 + p-6; we override p-0, bg-card, shadow-2xl, sm:rounded-2xl, backdrop-blur-xl.
              "fixed left-[50%] top-[50%] z-[120] grid w-full max-w-md translate-x-[-50%] translate-y-[-50%] gap-4 border border-border bg-card p-0 text-card-foreground shadow-2xl backdrop-blur-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-2xl",
              destructive && "border-destructive/30",
            )}
          >
            <div className="p-6 pb-0">
              <div className="flex flex-col space-y-3 text-left">
                <div
                  className={cn(
                    "flex h-11 w-11 items-center justify-center rounded-xl border",
                    destructive
                      ? "border-destructive/30 bg-destructive/10 text-destructive"
                      : "border-primary/20 bg-primary/10 text-primary",
                  )}
                >
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <DialogPrimitive.Title className="pr-2 text-lg font-semibold leading-snug text-foreground">
                  {options?.title ?? ""}
                </DialogPrimitive.Title>
                {options?.description ? (
                  <DialogPrimitive.Description asChild>
                    <div className="max-h-[min(40vh,16rem)] min-w-0 overflow-y-auto text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                      {options.description}
                    </div>
                  </DialogPrimitive.Description>
                ) : (
                  <DialogPrimitive.Description className="sr-only">
                    Please confirm or cancel.
                  </DialogPrimitive.Description>
                )}
              </div>
            </div>
            <div className="flex flex-row gap-2 border-t border-border bg-muted/50 px-6 py-4 sm:justify-end">
              <button
                type="button"
                className={cn(buttonVariants({ variant: "outline" }), "mt-0")}
                onClick={() => finish(false)}
              >
                {options?.cancelLabel ?? "Cancel"}
              </button>
              <button
                type="button"
                className={cn(
                  buttonVariants({ variant: destructive ? "destructive" : "default" }),
                  "min-w-[5.5rem]",
                )}
                onClick={() => finish(true)}
              >
                {options?.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used within ConfirmProvider");
  }
  return ctx;
}
