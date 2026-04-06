"use client";

import { BadgeCheck, Building2, Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const PLANS = [
  {
    id: "free" as const,
    name: "Free",
    description: "Included for every account. Enough to try Weehawk Cloud end-to-end.",
    icon: Sparkles,
    highlight: "Default",
    emphasis: "border-primary/25 bg-primary/[0.06]",
    price: "$0",
    priceSuffix: "/ month",
    priceNote: "For everyone — no credit card",
    cta: { kind: "free" as const },
    features: [
      "1 remote server (SSH host)",
      "1 project",
      "Up to 3 services per project",
      "Docker console on connected hosts",
      "Webhooks & cron jobs (fair use)",
      "Community / docs support",
    ],
  },
  {
    id: "startup" as const,
    name: "Startup",
    description: "Higher limits for small teams shipping often. Billing ties in later.",
    icon: BadgeCheck,
    highlight: "Coming soon",
    emphasis: "border-border",
    price: "$49",
    priceSuffix: "/ month",
    priceNote: "Billed monthly · cancel anytime",
    cta: { kind: "pay" as const, label: "Pay now" },
    features: [
      "Up to 5 remote servers",
      "Up to 10 projects",
      "Up to 25 services per project",
      "Registry, Git, S3 & notifications",
      "Email support (planned)",
      "Usage alerts & basic analytics (planned)",
    ],
  },
  {
    id: "enterprise" as const,
    name: "Enterprise",
    description: "Scale, compliance, and hands-on support when you need it.",
    icon: Building2,
    highlight: "Coming soon",
    emphasis: "border-border",
    price: "$199",
    priceSuffix: "/ month",
    priceNote: "Volume discounts · annual billing available",
    cta: { kind: "pay" as const, label: "Pay now" },
    features: [
      "Unlimited servers & projects (fair use)",
      "Unlimited services (fair use)",
      "SSO, audit logs & RBAC (planned)",
      "Dedicated support & SLAs (planned)",
      "Custom regions & VPC options (planned)",
      "Invoice billing & procurement (planned)",
    ],
  },
];

export function SubscriptionClient() {
  const { toast } = useToast();

  const onPay = (planName: string) => {
    toast({
      title: "Checkout coming soon",
      description: `${planName} billing is not connected yet. You’ll complete payment here in a future update.`,
    });
  };

  return (
    <div className="space-y-8 pb-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Subscription</h1>
        <p className="mt-1 text-sm text-muted-foreground leading-relaxed max-w-2xl">
          Prices are indicative; checkout will unlock in a later release. Plan limits remain product targets until enforced.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {PLANS.map((plan) => {
          const Icon = plan.icon;
          return (
            <div
              key={plan.id}
              className={cn(
                "glass-panel flex min-h-[320px] flex-col gap-4 rounded-2xl border p-6",
                plan.emphasis,
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/50">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <span
                  className={cn(
                    "rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider",
                    plan.id === "free"
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border bg-muted/40 text-muted-foreground",
                  )}
                >
                  {plan.highlight}
                </span>
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">{plan.name}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{plan.description}</p>
              </div>

              <div className="rounded-xl border border-border/80 bg-muted/30 px-4 py-3 dark:bg-muted/20">
                <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0">
                  <span className="text-3xl font-bold tracking-tight tabular-nums">{plan.price}</span>
                  <span className="text-sm text-muted-foreground">{plan.priceSuffix}</span>
                </div>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">{plan.priceNote}</p>
              </div>

              {plan.cta.kind === "free" ? (
                <div
                  role="status"
                  className="w-full rounded-lg border border-dashed border-primary/40 bg-primary/5 py-3 px-3 text-center text-sm font-medium leading-snug text-foreground"
                >
                  <span className="block text-primary">For everyone</span>
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    Included at no cost — no checkout on this tier
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn-primary w-full"
                  onClick={() => onPay(plan.name)}
                >
                  {plan.cta.label}
                </button>
              )}

              <div className="border-t border-border pt-4">
                <p className="mb-2.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  Included
                </p>
                <ul className="space-y-2">
                  {plan.features.map((line) => (
                    <li key={line} className="flex gap-2 text-sm leading-snug text-foreground/95">
                      <Check
                        className={cn(
                          "mt-0.5 h-4 w-4 shrink-0",
                          plan.id === "free" ? "text-primary" : "text-muted-foreground",
                        )}
                        aria-hidden
                      />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
