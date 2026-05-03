"use client";

import type { ReactNode } from "react";

export type ConfirmDangerDescriptionProps = {
  lead: ReactNode;
  /** Long name, id, ref, or newline-separated list — wraps inside the panel */
  emphasis?: string | null;
  hint?: ReactNode;
  /**
   * When true (e.g. bulk delete), the names panel grows with content up to a max height,
   * then stays capped and scrolls so the dialog does not grow with very long lists.
   */
  emphasisFixedScroll?: boolean;
};

/** Layout for destructive confirms so long identifiers stay inside the dialog (docker manager, secrets, …). */
export function ConfirmDangerDescription({
  lead,
  emphasis,
  hint,
  emphasisFixedScroll = false,
}: ConfirmDangerDescriptionProps) {
  const em = emphasis != null ? String(emphasis).trim() : "";
  return (
    <div className="space-y-3">
      <div>{lead}</div>
      {em.length > 0 ? (
        <p
          className={
            emphasisFixedScroll
              ? "max-h-20 min-h-0 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/50 px-3 py-2 font-mono text-[11px] leading-snug text-foreground shadow-inner"
              : "max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/50 px-3 py-2 font-mono text-[11px] leading-snug text-foreground shadow-inner"
          }
          title={em.replace(/\s+/g, " ").slice(0, 500)}
        >
          {em}
        </p>
      ) : null}
      {hint != null ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
