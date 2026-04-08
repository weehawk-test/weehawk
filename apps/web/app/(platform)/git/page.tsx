"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default function GitLandingPage() {
  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Git</h1>
          <p className="text-muted-foreground">
            Choose where Weehawk stores credentials for pulling application source.
            <br />
            GitHub uses a GitHub App (manifest flow). GitLab uses a personal or group access token.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        <Link
          href="/git/github"
          scroll={false}
          className="glass-panel backdrop-blur-none rounded-2xl p-6 flex flex-col min-h-[180px] group interactive-card"
        >
          <div className="flex items-start gap-3 min-w-0 mb-4">
            <div className="h-12 w-12 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0 p-2">
              <Image
                src="/deployment-sources/github.svg"
                alt=""
                width={48}
                height={48}
                className="h-8 w-8 object-contain dark:invert"
              />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-lg leading-tight text-foreground">GitHub</h2>
              <p className="text-xs text-muted-foreground mt-1">GitHub App · manifest setup</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed flex-1">
            Register an app on GitHub, then return here with credentials saved automatically when
            you use the manifest link.
          </p>
          <div className="mt-auto pt-4 border-t border-white/5 flex items-center justify-end">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-primary group-hover:gap-3 transition-all">
              Configure GitHub
              <ArrowRight className="w-4 h-4" />
            </span>
          </div>
        </Link>

        <Link
          href="/git/gitlab"
          scroll={false}
          className="glass-panel backdrop-blur-none rounded-2xl p-6 flex flex-col min-h-[180px] group interactive-card"
        >
          <div className="flex items-start gap-3 min-w-0 mb-4">
            <div className="h-12 w-12 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0 p-2">
              <Image
                src="/deployment-sources/gitlab.svg"
                alt=""
                width={48}
                height={48}
                className="h-8 w-8 object-contain"
              />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-lg leading-tight text-foreground">GitLab</h2>
              <p className="text-xs text-muted-foreground mt-1">Personal or group token</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed flex-1">
            Connect GitLab.com or your self-managed instance with a saved access token.
          </p>
          <div className="mt-auto pt-4 border-t border-white/5 flex items-center justify-end">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-primary group-hover:gap-3 transition-all">
              Configure GitLab
              <ArrowRight className="w-4 h-4" />
            </span>
          </div>
        </Link>
      </div>
    </>
  );
}
