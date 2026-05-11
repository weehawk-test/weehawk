"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Monitor, Server } from "lucide-react";
import { cn } from "@/lib/utils";
import { writeServerDeployChoice } from "@/lib/server-deploy-preference";
import { writeSelfHostedFirstInstallState } from "@/lib/self-hosted-first-install";

type Props = {
  onSetupLater: () => void;
};

export function SelfHostedDeployInstallSection({ onSetupLater }: Props) {
  const router = useRouter();

  const goThisMachine = () => {
    writeServerDeployChoice("localhost");
    router.push("/onboarding/self-hosted-this-machine");
  };

  const goRemote = () => {
    writeServerDeployChoice("remote");
    router.push("/onboarding/ssh");
  };

  const finishLater = () => {
    writeSelfHostedFirstInstallState("done");
    onSetupLater();
  };

  return (
    <div className="space-y-4">
      <header className="space-y-1.5 border-b border-white/10 pb-3.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Install</p>
        <h2 className="text-base sm:text-lg font-semibold tracking-tight text-foreground">
          This machine or a remote server?
        </h2>
        <p className="text-[13px] sm:text-sm leading-relaxed text-muted-foreground">
          You are the first administrator on this self-hosted instance. Run workloads on the same machine that hosts
          Weehawk, or connect a different server over SSH.
        </p>
      </header>

      <div className="flex flex-col gap-2.5">
        <InstallOptionCard
          icon={<Monitor className="size-4" aria-hidden />}
          title="This machine"
          body="Deploy on the server where Weehawk is running. Next, confirm adding the default local deploy host (same layout as the SSH step)."
          actionLabel="Review and confirm"
          onSelect={goThisMachine}
        />
        <InstallOptionCard
          icon={<Server className="size-4" aria-hidden />}
          title="Remote server"
          body="Use another machine you control (VPS, cloud VM, homelab). Next, you will add SSH keys and connection details."
          actionLabel="Continue to SSH setup"
          onSelect={goRemote}
        />
      </div>

      <div className="flex flex-col items-center gap-1 border-t border-white/10 pt-3.5">
        <button
          type="button"
          className="text-xs sm:text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          onClick={finishLater}
        >
          Set up later
        </button>
      </div>
    </div>
  );
}

function InstallOptionCard({
  icon,
  title,
  body,
  actionLabel,
  onSelect,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  actionLabel: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-left transition-all sm:gap-3.5 sm:p-4",
        "hover:border-white/18 hover:bg-white/[0.05]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      <div className="flex size-9 sm:size-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-primary/90">
        {icon}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5 pt-px">
        <span className="text-[13px] sm:text-sm font-medium leading-none text-foreground">{title}</span>
        <p className="text-[13px] sm:text-sm leading-relaxed text-muted-foreground">{body}</p>
        <p className="text-xs font-medium text-muted-foreground underline-offset-4 pt-0.5">{actionLabel}</p>
      </div>
    </button>
  );
}
