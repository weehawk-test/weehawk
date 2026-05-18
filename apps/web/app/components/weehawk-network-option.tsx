"use client";

import { Network } from "lucide-react";

export function WeehawkNetworkOption({
  attached,
  onAttachedChange,
  disabled,
  hint,
}: {
  attached: boolean;
  onAttachedChange: (next: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/25 p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10">
          <Network className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary"
              checked={attached}
              disabled={disabled}
              onChange={(e) => onAttachedChange(e.target.checked)}
            />
            <span className="text-sm font-medium text-foreground leading-snug">
              Join the shared <span className="font-mono text-xs">weehawk</span> network
            </span>
          </label>
          <p className="text-[11px] text-muted-foreground leading-snug pl-6">
            {hint ??
              "When enabled, this service joins the Traefik overlay so domains and other Weehawk services can reach it. When disabled, it stays on its own isolated network(s) only."}
          </p>
        </div>
      </div>
    </div>
  );
}
