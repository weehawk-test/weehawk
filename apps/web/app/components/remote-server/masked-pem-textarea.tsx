"use client";

import { type ComponentPropsWithoutRef } from "react";
import { Lock, LockOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const MASK_CHAR = "\u00B7"; // middle dot — lighter than bullet •

/** Visual-only mask: one soft dot run per line (PEM shape, no real secret). */
function pemVisualMask(pem: string): string {
  return pem
    .split("\n")
    .map((line) => {
      if (line.length === 0) return "";
      const n = Math.min(72, Math.max(12, line.length));
      return MASK_CHAR.repeat(n);
    })
    .join("\n");
}

export type MaskedPemTextareaProps = Omit<
  ComponentPropsWithoutRef<"textarea">,
  "value" | "onChange"
> & {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  /** When false and value is non-empty, the PEM is concealed like a password field. */
  revealed: boolean;
  onRevealedChange: (revealed: boolean) => void;
};

export function MaskedPemTextarea({
  value,
  onChange,
  revealed,
  onRevealedChange,
  className,
  onScroll,
  readOnly: readOnlyProp,
  ...rest
}: MaskedPemTextareaProps) {
  const hasSecret = value.trim().length > 0;
  const concealed = !revealed && hasSecret;
  const locked = concealed;

  const lockAgainBtnClass = cn(
    "absolute right-2.5 top-2 z-[2] flex size-8 items-center justify-center rounded-md",
    "bg-background/70 text-muted-foreground shadow-sm ring-1 ring-border/60 backdrop-blur-[2px]",
    "transition-colors hover:bg-muted/80 hover:text-foreground",
    "dark:bg-background/50 dark:ring-border/50 dark:hover:bg-muted/40",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  );

  return (
    <div className="relative">
      <textarea
        {...rest}
        value={value}
        onChange={onChange}
        readOnly={locked || readOnlyProp}
        onScroll={onScroll}
        className={cn(
          "leading-5",
          hasSecret && revealed && "pr-11",
          className,
          concealed &&
            "cursor-default overflow-hidden overscroll-none text-transparent caret-transparent selection:bg-transparent selection:text-transparent tracking-[0.22em] select-none",
        )}
      />
      {concealed ? (
        <>
          <div
            className={cn(
              "pointer-events-none absolute inset-px z-[1] overflow-hidden rounded-[calc(0.5rem-1px)]",
              "bg-gradient-to-b from-muted/30 via-muted/10 to-muted/25",
              "dark:from-muted/25 dark:via-muted/[0.07] dark:to-muted/20",
              "shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.06)]",
              "dark:shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.04)]",
            )}
            aria-hidden
          >
            <pre
              className={cn(
                "m-0 whitespace-pre-wrap break-all px-3 py-2 font-mono text-[11px] leading-5 sm:text-xs",
                "tracking-[0.22em] text-muted-foreground/40 antialiased",
                "dark:text-muted-foreground/35",
              )}
            >
              {pemVisualMask(value)}
            </pre>
          </div>
          <div className="pointer-events-none absolute inset-px z-[2] flex items-center justify-center rounded-[calc(0.5rem-1px)]">
            <button
              type="button"
              onClick={() => onRevealedChange(true)}
              className={cn(
                "pointer-events-auto inline-flex flex-col items-center gap-1 rounded-md border border-border/80",
                "bg-background/95 px-3 py-2 text-center text-xs shadow-sm backdrop-blur-sm transition-colors",
                "ring-1 ring-black/5 hover:bg-muted/90 hover:ring-border dark:bg-background/90 dark:ring-white/10",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              )}
              aria-label="Show private key"
            >
              <Lock className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              <span className="max-w-[12rem] text-center font-medium leading-tight text-foreground">
                Show private key
              </span>
            </button>
          </div>
        </>
      ) : null}
      {revealed && hasSecret ? (
        <button
          type="button"
          className={lockAgainBtnClass}
          onClick={() => onRevealedChange(false)}
          aria-label="Hide private key"
        >
          <LockOpen className="size-3.5" strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  );
}
