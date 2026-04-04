import type { AuthResponse } from "@/lib/auth-api";

const KEY = "weehawk-onboarding-pending-auth";

/** First Google sign-in (cloud): session is already in cookies; gate onboarding until cleared. */
const OAUTH_CLOUD_ONBOARDING_KEY = "weehawk-oauth-cloud-onboarding";

export function markOauthCloudOnboardingPending(): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(OAUTH_CLOUD_ONBOARDING_KEY, "1");
}

export function isOauthCloudOnboardingPending(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(OAUTH_CLOUD_ONBOARDING_KEY) === "1";
}

export function clearOauthCloudOnboardingPending(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(OAUTH_CLOUD_ONBOARDING_KEY);
}

export function savePendingOnboardingAuth(auth: AuthResponse): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(KEY, JSON.stringify(auth));
}

export function readPendingOnboardingAuth(): AuthResponse | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<AuthResponse>;
    if (typeof j.accessToken === "string" && typeof j.refreshToken === "string") {
      return j as AuthResponse;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function clearPendingOnboardingAuth(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(KEY);
}

export function clearAllOnboardingSession(): void {
  clearPendingOnboardingAuth();
  clearOauthCloudOnboardingPending();
}
