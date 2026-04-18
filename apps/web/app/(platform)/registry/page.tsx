"use client";

import Link from "next/link";
import { ArrowRight, Globe2 } from "lucide-react";

type ProviderCard = {
  id: "dockerhub" | "ghcr" | "gitlab" | "custom";
  name: string;
  providerUrl: string;
  cardCta: string;
};

function DockerHubLogoIcon({ className }: { className?: string }) {
  return <img src="/registry/docker-hub.svg" alt="" className={className} aria-hidden />;
}

function GitHubLogoIcon({ className }: { className?: string }) {
  return <img src="/deployment-sources/github.svg" alt="" className={`${className} dark:invert`} aria-hidden />;
}

function GitLabLogoIcon({ className }: { className?: string }) {
  return <img src="/deployment-sources/gitlab.svg" alt="" className={className} aria-hidden />;
}

const PROVIDERS: ProviderCard[] = [
  {
    id: "dockerhub",
    name: "Docker Hub",
    providerUrl: "docker.io",
    cardCta: "Configure Docker Hub",
  },
  {
    id: "ghcr",
    name: "GitHub Registry",
    providerUrl: "ghcr.io",
    cardCta: "Configure GHCR",
  },
  {
    id: "gitlab",
    name: "GitLab Registry",
    providerUrl: "registry.gitlab.com",
    cardCta: "Configure GitLab",
  },
  {
    id: "custom",
    name: "Custom Registry",
    providerUrl: "your-registry.example.com",
    cardCta: "Configure Custom",
  },
];

export default function RegistryPage() {
  return (
    <div className="w-full pb-10">
      <header className="mb-10 md:mb-12">
        <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">Registry</h1>
        <p className="mt-3 text-muted-foreground leading-relaxed">
          Choose where Weehawk stores credentials for pushing and pulling images.
          <br />
          Docker Hub, GHCR, GitLab, or a custom private registry.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6">
        {PROVIDERS.map((provider) => (
          <Link
            key={provider.id}
            href={`/registry/${provider.id}`}
            scroll={false}
            className="group interactive-card flex min-h-[168px] flex-col rounded-3xl border border-border/70 bg-card/40 p-8 shadow-sm transition-colors hover:border-primary/30 hover:bg-card/60 dark:border-white/10 dark:bg-card/30 dark:shadow-none dark:hover:bg-card/50"
          >
            <div className="flex flex-1 flex-col gap-5 sm:flex-row sm:items-start">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-zinc-200/90 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-950/90 dark:shadow-none">
                {provider.id === "dockerhub" ? (
                  <DockerHubLogoIcon className="h-10 w-10 object-contain" />
                ) : provider.id === "ghcr" ? (
                  <GitHubLogoIcon className="h-10 w-10 object-contain" />
                ) : provider.id === "gitlab" ? (
                  <GitLabLogoIcon className="h-10 w-10 object-contain" />
                ) : (
                  <Globe2 className="h-10 w-10 text-sky-500" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-semibold tracking-tight text-foreground">{provider.name}</h2>
                <p className="mt-1.5 font-mono text-sm text-muted-foreground">{provider.providerUrl}</p>
              </div>
            </div>
            <div className="mt-8 flex items-center justify-end border-t border-border/60 pt-6 dark:border-white/10">
              <span className="inline-flex items-center gap-2 text-sm font-medium text-primary transition-all group-hover:gap-3">
                {provider.cardCta}
                <ArrowRight className="h-4 w-4" />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
