/**
 * Must match `WEEHAWK_EDITION` on the API (`cloud` | `selfhosted`).
 *
 * Set in the web app only: `NEXT_PUBLIC_WEEHAWK_EDITION` in `apps/web/.env.local`
 * (or deployment env). Next exposes this on server and in the browser bundle.
 */
export function isCloudEdition(): boolean {
  return (process.env.NEXT_PUBLIC_WEEHAWK_EDITION ?? "").toLowerCase() === "cloud";
}

/**
 * Same edition label as {@link isCloudEdition} for UI before `/api/auth/setup-status` resolves
 * (e.g. first paint after refresh). Avoids flashing `selfhosted` while the query is loading.
 */
export function editionFromEnv(): "cloud" | "selfhosted" {
  return isCloudEdition() ? "cloud" : "selfhosted";
}
