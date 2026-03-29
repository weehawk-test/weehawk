"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ConfirmOptions = {
  title: string;
  description?: string;
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
      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogContent
          className={cn(
            "max-w-md border border-white/10 bg-zinc-950/95 p-0 shadow-2xl backdrop-blur-xl sm:rounded-2xl",
            destructive && "border-destructive/25",
          )}
        >
          <div className="p-6 pb-0">
            <AlertDialogHeader className="space-y-3 text-left">
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
              <AlertDialogTitle className="text-lg font-semibold leading-snug pr-2">
                {options?.title ?? ""}
              </AlertDialogTitle>
              {options?.description ? (
                <AlertDialogDescription className="text-sm leading-relaxed text-muted-foreground">
                  {options.description}
                </AlertDialogDescription>
              ) : (
                <AlertDialogDescription className="sr-only">Please confirm or cancel.</AlertDialogDescription>
              )}
            </AlertDialogHeader>
          </div>
          <AlertDialogFooter className="flex-row gap-2 border-t border-white/5 bg-black/20 px-6 py-4 sm:justify-end">
            <AlertDialogCancel className="mt-0 border-white/10 bg-transparent hover:bg-white/5">
              {options?.cancelLabel ?? "Cancel"}
            </AlertDialogCancel>
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
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
