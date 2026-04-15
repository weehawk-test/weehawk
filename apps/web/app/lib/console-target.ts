/** `local` = Docker on the Weehawk API host; string = `remote_servers.publicId` (legacy numeric still accepted). */
export type DockerConsoleTarget = "local" | string;

/** URL segment under `/console/[serverId]` → target, or null if invalid */
export function parseConsoleServerSlug(slug: string): DockerConsoleTarget | null {
  if (slug === "local") return "local";
  if (/^[A-Za-z0-9_-]+$/.test(slug)) return slug;
  return null;
}
