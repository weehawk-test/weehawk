"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, GitBranch } from "lucide-react";

export default function GitLandingPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-10 pb-12">
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/20 to-transparent">
          <GitBranch className="w-7 h-7 text-primary" />
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-mono mb-1">
            Source control
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Git</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-lg leading-relaxed">
            Choose where Weehawk stores credentials for pulling application source. GitHub uses a
            GitHub App (manifest flow). GitLab uses a personal or group access token.
          </p>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Link
          href="/git/github"
          scroll={false}
          className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 via-card/40 to-card/20 p-8 transition-all duration-300 hover:border-primary/35 hover:shadow-[0_20px_60px_-24px_rgba(59,130,246,0.35)]"
        >
          <div className="absolute -right-6 -top-6 h-32 w-32 rounded-full bg-blue-500/10 blur-3xl pointer-events-none group-hover:bg-blue-500/15 transition-colors" />
          <div className="relative flex flex-col h-full min-h-[220px]">
            <div className="flex items-center gap-4 mb-5">
              <div className="rounded-xl border border-white/10 bg-black/30 p-3 shadow-inner">
                <Image
                  src="/deployment-sources/github.png"
                  alt=""
                  width={48}
                  height={48}
                  className="h-12 w-12 object-contain"
                />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-foreground">GitHub</h2>
                <p className="text-xs text-muted-foreground mt-0.5">GitHub App · manifest setup</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed flex-1">
              Register an app on GitHub, then return here with credentials saved automatically when
              you use the manifest link.
            </p>
            <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-primary group-hover:gap-3 transition-all">
              Configure GitHub
              <ArrowRight className="w-4 h-4" />
            </span>
          </div>
        </Link>

        <Link
          href="/git/gitlab"
          scroll={false}
          className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-orange-950/30 via-card/40 to-card/20 p-8 transition-all duration-300 hover:border-orange-500/30 hover:shadow-[0_20px_60px_-24px_rgba(234,88,12,0.25)]"
        >
          <div className="absolute -right-6 -top-6 h-32 w-32 rounded-full bg-orange-500/10 blur-3xl pointer-events-none group-hover:bg-orange-500/15 transition-colors" />
          <div className="relative flex flex-col h-full min-h-[220px]">
            <div className="flex items-center gap-4 mb-5">
              <div className="rounded-xl border border-white/10 bg-black/30 p-3 shadow-inner">
                <Image
                  src="/deployment-sources/gitlab.png"
                  alt=""
                  width={48}
                  height={48}
                  className="h-12 w-12 object-contain"
                />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-foreground">GitLab</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Personal or group token</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed flex-1">
              Connect GitLab.com or your self-managed instance with a saved access token.
            </p>
            <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-orange-300/90 group-hover:gap-3 transition-all">
              Configure GitLab
              <ArrowRight className="w-4 h-4" />
            </span>
          </div>
        </Link>
      </div>
    </div>
  );
}
