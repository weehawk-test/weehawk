/** First self-hosted admin install wizard; set after first registration only. */
export const SELF_HOSTED_FIRST_INSTALL_KEY = "weehawk-self-hosted-first-install-v1";

export type SelfHostedFirstInstallState = "pending" | "done";

export function readSelfHostedFirstInstallState(): SelfHostedFirstInstallState | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(SELF_HOSTED_FIRST_INSTALL_KEY);
  return v === "pending" || v === "done" ? v : null;
}

export function writeSelfHostedFirstInstallState(state: SelfHostedFirstInstallState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SELF_HOSTED_FIRST_INSTALL_KEY, state);
}
