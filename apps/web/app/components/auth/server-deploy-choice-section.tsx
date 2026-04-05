"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  type ServerDeployTarget,
  writeServerDeployChoice,
} from "@/lib/server-deploy-preference";
import { Monitor, Server } from "lucide-react";

type Props = {
  variant: "selfhosted" | "cloud";
  value: ServerDeployTarget;
  onChange: (v: ServerDeployTarget) => void;
  /** Skip saving a target now; stores `later` and lets the parent continue. */
  onSetupLater?: () => void;
  /** Cloud: navigate to a separate SSH step instead of an inline panel. */
  onRemoteSshSetup?: () => void;
  /** Shown after the user clicks “Remote server” (cloud only), when not using `onRemoteSshSetup`. */
  remoteSshSetupPanel?: ReactNode;
};

export function ServerDeployChoiceSection({
  variant,
  value,
  onChange,
  onSetupLater,
  onRemoteSshSetup,
  remoteSshSetupPanel,
}: Props) {
  const [remoteSshRevealed, setRemoteSshRevealed] = useState(false);
  const sshSeparatePage = Boolean(onRemoteSshSetup);

  useEffect(() => {
    writeServerDeployChoice(value);
  }, [value]);

  const isCloud = variant === "cloud";

  return (
    <div className="space-y-5">
      <header className="space-y-2 border-b border-white/10 pb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Server</p>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          {isCloud ? "Your deployment targets" : "Where should Weehawk run your workloads?"}
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {isCloud
            ? sshSeparatePage
              ? "Step 1 of 2: Weehawk Cloud runs Docker on servers you reach over SSH. Click Remote server to open the SSH connection page, or set up later."
              : "Weehawk Cloud runs Docker on machines you reach over SSH (VPS, cloud VM, or homelab). Click Remote server to open the SSH setup form, or skip and configure later."
            : "Pick how CPU and RAM will be used for your apps and services. Use localhost on this machine, or connect a remote host over SSH. You can change this later in settings."}
        </p>
      </header>

      <div className="flex flex-col gap-3">
        {!isCloud && (
          <OptionRow
            disabled={false}
            selected={value === "localhost"}
            onSelect={() => {
              setRemoteSshRevealed(false);
              onChange("localhost");
            }}
            icon={<Monitor className="size-4" aria-hidden />}
            title="Localhost"
            badge={null}
            body="This machine—the same one running Weehawk. Great to get started. For heavier production use, many teams prefer not to mix the dashboard and workloads on one box."
            footnote="Ready to use"
          />
        )}

        <OptionRow
          disabled={false}
          selected={
            isCloud && !sshSeparatePage ? value === "remote" && remoteSshRevealed : value === "remote"
          }
          onSelect={() => {
            onChange("remote");
            if (sshSeparatePage) {
              onRemoteSshSetup?.();
            } else if (isCloud) {
              setRemoteSshRevealed(true);
            }
          }}
          icon={<Server className="size-4" aria-hidden />}
          title="Remote servers"
          badge={null}
          body={
            isCloud
              ? sshSeparatePage
                ? "Use a VPS, cloud VM, or home server over SSH. Click to go to step 2: generate keys, save the host in the database, and test Docker over SSH."
                : "Use a VPS, cloud VM, or home server you reach over SSH. Click this card to open the SSH connection form—generate keys, save the host, and test Docker over SSH."
              : sshSeparatePage
                ? "Use a VPS, cloud VM, or home server over SSH. Click to go to step 2: generate keys, save the host, and test Docker over SSH."
                : "Use any machine you reach over SSH—VPS, cloud VM, or homelab. Click this card to open the SSH connection form."
          }
          footnote={
            sshSeparatePage
              ? "Open step 2 — SSH connection"
              : isCloud
                ? remoteSshRevealed
                  ? "Default for Weehawk Cloud"
                  : "Click to open SSH setup"
                : null
          }
        />
      </div>

      {isCloud && !sshSeparatePage && remoteSshRevealed && value === "remote" && remoteSshSetupPanel ? (
        <div className="pt-1">{remoteSshSetupPanel}</div>
      ) : null}

      {onSetupLater ? (
        <div className="flex flex-col items-center gap-1 border-t border-white/10 pt-4">
          <button
            type="button"
            className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            onClick={onSetupLater}
          >
            Set up later
          </button>
        </div>
      ) : null}
    </div>
  );
}

function OptionRow({
  disabled,
  selected,
  onSelect,
  icon,
  title,
  badge,
  body,
  footnote,
}: {
  disabled: boolean;
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  badge: ReactNode;
  body: string;
  footnote: string | null;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full gap-3.5 rounded-xl border p-4 text-left transition-all sm:gap-4 sm:p-4",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        disabled && "cursor-not-allowed border-dashed border-white/10 bg-white/[0.02] opacity-[0.58]",
        !disabled && !selected && "border-white/10 bg-white/[0.03] hover:border-white/18 hover:bg-white/[0.05]",
        !disabled &&
          selected &&
          "border-primary/45 bg-primary/[0.09] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] ring-1 ring-primary/25",
      )}
    >
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg",
          selected && !disabled ? "bg-primary/20 text-primary" : "bg-white/[0.06] text-primary/90",
        )}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5 pt-px">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium leading-none text-foreground">{title}</span>
          {badge}
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
        {footnote ? <p className="text-xs font-medium text-primary">{footnote}</p> : null}
      </div>
    </button>
  );
}
