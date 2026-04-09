"use client";

import Link from "next/link";
import { ArrowRight, Globe2 } from "lucide-react";

type ProviderCard = {
  id: "dockerhub" | "ghcr" | "gitlab" | "custom";
  name: string;
  providerUrl: string;
  cardDescription: string;
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
    cardDescription: "Use Docker Hub credentials to push and pull images from the default registry.",
    cardCta: "Configure Docker Hub",
  },
  {
    id: "ghcr",
    name: "GitHub Registry",
    providerUrl: "ghcr.io",
    cardDescription: "Connect GHCR with your GitHub account and save credentials securely on the server.",
    cardCta: "Configure GHCR",
  },
  {
    id: "gitlab",
    name: "GitLab Registry",
    providerUrl: "registry.gitlab.com",
    cardDescription: "Add GitLab Container Registry credentials for private image pushes.",
    cardCta: "Configure GitLab",
  },
  {
    id: "custom",
    name: "Custom Registry",
    providerUrl: "your-registry.example.com",
    cardDescription: "Use any private or self-hosted registry by entering its domain and credentials.",
    cardCta: "Configure Custom",
  },
];

export default function RegistryPage() {
  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Registry</h1>
          <p className="text-muted-foreground">
            Choose where Weehawk stores credentials for pushing and pulling images.
            <br />
            Docker Hub, GHCR, GitLab, or a custom private registry.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {PROVIDERS.map((provider) => (
          <Link
            key={provider.id}
            href={`/registry/${provider.id}`}
            scroll={false}
            className="glass-panel backdrop-blur-none rounded-2xl p-6 flex flex-col min-h-[180px] group interactive-card"
          >
            <div className="flex items-start gap-3 min-w-0 mb-4">
              <div className="h-12 w-12 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0 p-2">
                {provider.id === "dockerhub" ? (
                  <DockerHubLogoIcon className="h-8 w-8 object-contain" />
                ) : provider.id === "ghcr" ? (
                  <GitHubLogoIcon className="h-8 w-8 object-contain" />
                ) : provider.id === "gitlab" ? (
                  <GitLabLogoIcon className="h-8 w-8 object-contain" />
                ) : (
                  <Globe2 className="h-8 w-8 text-sky-500" />
                )}
              </div>
              <div className="min-w-0">
                <h2 className="font-semibold text-lg leading-tight text-foreground">{provider.name}</h2>
                <p className="text-xs text-muted-foreground mt-1 font-mono">{provider.providerUrl}</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed flex-1">{provider.cardDescription}</p>
            <div className="mt-auto pt-4 border-t border-white/5 flex items-center justify-end">
              <span className="inline-flex items-center gap-2 text-sm font-medium text-primary group-hover:gap-3 transition-all">
                {provider.cardCta}
                <ArrowRight className="w-4 h-4" />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
