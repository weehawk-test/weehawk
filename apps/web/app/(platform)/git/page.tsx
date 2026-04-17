"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default function GitLandingPage() {
  return (
    <div className="mx-auto max-w-4xl pb-10">
      <header className="mb-10 md:mb-12 max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">Git</h1>
        <p className="mt-3 text-muted-foreground leading-relaxed">
          Choose where Weehawk stores credentials for pulling application source.
          <br />
          GitHub uses a GitHub App (create app, then install to grant repo access). GitLab uses an
          access token.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6">
        <Link
          href="/git/github"
          scroll={false}
          className="group interactive-card flex min-h-[168px] flex-col rounded-3xl border border-border/70 bg-card/40 p-8 shadow-sm transition-colors hover:border-primary/30 hover:bg-card/60 dark:border-white/10 dark:bg-card/30 dark:shadow-none dark:hover:bg-card/50"
        >
          <div className="flex flex-1 flex-col gap-5 sm:flex-row sm:items-start">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-zinc-200/90 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-950/90 dark:shadow-none">
              <Image
                src="/deployment-sources/github.svg"
                alt=""
                width={40}
                height={40}
                className="h-10 w-10 object-contain dark:invert"
              />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">GitHub</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">GitHub App · manifest + install</p>
            </div>
          </div>
          <div className="mt-8 flex items-center justify-end border-t border-border/60 pt-6 dark:border-white/10">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-primary transition-all group-hover:gap-3">
              Configure GitHub
              <ArrowRight className="h-4 w-4" />
            </span>
          </div>
        </Link>

        <Link
          href="/git/gitlab"
          scroll={false}
          className="group interactive-card flex min-h-[168px] flex-col rounded-3xl border border-border/70 bg-card/40 p-8 shadow-sm transition-colors hover:border-primary/30 hover:bg-card/60 dark:border-white/10 dark:bg-card/30 dark:shadow-none dark:hover:bg-card/50"
        >
          <div className="flex flex-1 flex-col gap-5 sm:flex-row sm:items-start">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-zinc-200/90 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-950/90 dark:shadow-none">
              <Image
                src="/deployment-sources/gitlab.svg"
                alt=""
                width={40}
                height={40}
                className="h-10 w-10 object-contain"
              />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">GitLab</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">Personal or group token</p>
            </div>
          </div>
          <div className="mt-8 flex items-center justify-end border-t border-border/60 pt-6 dark:border-white/10">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-primary transition-all group-hover:gap-3">
              Configure GitLab
              <ArrowRight className="h-4 w-4" />
            </span>
          </div>
        </Link>
      </div>
    </div>
  );
}
