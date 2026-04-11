export type PlatformNewsCategory = "product" | "security" | "maintenance" | "community";

export type PlatformNewsItem = {
  id: string;
  title: string;
  summary: string;
  /** Full article body; paragraphs separated by blank lines. */
  content: string;
  publishedAt: string;
  category: PlatformNewsCategory;
};

/** Placeholder feed until a real CMS or API is wired up. */
export const MOCK_PLATFORM_NEWS: PlatformNewsItem[] = [
  {
    id: "1",
    title: "Weehawk Desktop 2.x: faster deploys and clearer logs",
    summary:
      "Rolling out performance work on the deployment pipeline and a redesigned activity stream so you can see build and rollout steps at a glance.",
    content: `We are rolling out the next wave of improvements for Weehawk Desktop, focused on speed and clarity when you ship.

The deployment pipeline now batches work more efficiently on the agent side, which cuts average rollout time for medium-sized stacks. You should notice snappier feedback in the UI as stages complete.

The activity stream has been redesigned: each deploy shows a clearer timeline of build, push, and service updates. Errors surface with direct links to the failing step where possible.

This release is available automatically on the latest Desktop build. If anything looks off, use Support from the Resources section and we will dig in.`,
    publishedAt: "2026-04-08",
    category: "product",
  },
  {
    id: "2",
    title: "Git integrations: improved token handling",
    summary:
      "We tightened how OAuth tokens are stored and refreshed for GitHub and GitLab. No action required unless you disconnected an account recently.",
    content: `We have hardened how GitHub and GitLab OAuth tokens are handled inside Weehawk.

Tokens are refreshed on a tighter schedule and invalid sessions are cleared more aggressively, so stale credentials are less likely to cause confusing errors during clone or webhook setup.

You do not need to reconnect your accounts unless you recently disconnected them or saw a repeated auth error. In that case, open Git settings, remove the integration, and sign in again once.

If your organization uses SSO or strict token policies, this change should reduce unexpected mid-session logouts.`,
    publishedAt: "2026-04-05",
    category: "security",
  },
  {
    id: "3",
    title: "Scheduled maintenance: registry cache",
    summary:
      "Brief registry cache refresh is planned during a low-traffic window. Pulls may be slightly slower for a few minutes; pushes are unaffected.",
    content: `We will refresh part of the registry cache infrastructure during a scheduled maintenance window in off-peak hours.

During the window, image pulls might be a few seconds slower than usual. Pushes and tag updates are not expected to be impacted.

We will keep the maintenance as short as possible and post a short note in Platform news if anything unexpected extends the window.

Thank you for your patience.`,
    publishedAt: "2026-03-28",
    category: "maintenance",
  },
  {
    id: "4",
    title: "Community highlight: Docker Compose tips",
    summary:
      "We published a short guide on structuring compose files for multi-service apps on Weehawk. Find it in Documentation → Guides.",
    content: `We published a practical guide on organizing Docker Compose files for multi-service applications you run through Weehawk.

It covers naming services consistently, using profiles for optional dependencies, and keeping environment-specific overrides separate so production stays predictable.

You will find the guide linked from Documentation under Guides. If you have a pattern that works well for your team, we would love to hear about it via Support.

Happy shipping.`,
    publishedAt: "2026-03-20",
    category: "community",
  },
];

export function getPlatformNewsById(id: string): PlatformNewsItem | undefined {
  return MOCK_PLATFORM_NEWS.find((n) => n.id === id);
}
