/** `local` = Docker on the Weehawk API host; number = `remote_servers.id` */
export type DockerConsoleTarget = "local" | number;

/** URL segment under `/console/[serverId]` → target, or null if invalid */
export function parseConsoleServerSlug(slug: string): DockerConsoleTarget | null {
  if (slug === "local") return "local";
  if (/^\d+$/.test(slug)) {
    const n = parseInt(slug, 10);
    if (n > 0) return n;
  }
  return null;
}
