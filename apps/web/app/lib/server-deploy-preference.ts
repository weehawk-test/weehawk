export const SERVER_DEPLOY_CHOICE_KEY = "weehawk-server-deploy-choice";

export type ServerDeployChoice = "localhost" | "remote" | "later";

/** Card selection during onboarding (`later` is only set via “Set up later”). */
export type ServerDeployTarget = Exclude<ServerDeployChoice, "later">;

export function readServerDeployChoice(): ServerDeployChoice | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(SERVER_DEPLOY_CHOICE_KEY);
  return v === "localhost" || v === "remote" || v === "later" ? v : null;
}

export function writeServerDeployChoice(choice: ServerDeployChoice): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SERVER_DEPLOY_CHOICE_KEY, choice);
}
